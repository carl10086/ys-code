// src/agent/agent.ts
import {
  type ImageContent,
  type Message,
  type Model,
  type SimpleStreamOptions,
  streamSimple,
  type TextContent,
  type ThinkingBudgets,
  type Transport,
} from "../core/ai/index.js";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentState,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  StreamFn,
  ToolExecutionMode,
} from "./types.js";

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
  );
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DEFAULT_MODEL = {
  id: "unknown",
  name: "unknown",
  api: "unknown",
  provider: "unknown",
  baseUrl: "",
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
} satisfies Model<any>;

/** 队列模式 */
type QueueMode = "all" | "one-at-a-time";

/** 可变 Agent 状态 */
type MutableAgentState = Omit<AgentState, "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

function createMutableAgentState(
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>,
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    systemPrompt: initialState?.systemPrompt ?? "",
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? "off",
    get tools() {
      return tools;
    },
    set tools(nextTools: AgentTool<any>[]) {
      tools = nextTools.slice();
    },
    get messages() {
      return messages;
    },
    set messages(nextMessages: AgentMessage[]) {
      messages = nextMessages.slice();
    },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

/** 待处理消息队列 */
class PendingMessageQueue {
  private messages: AgentMessage[] = [];

  /** @param mode 队列模式 */
  constructor(public mode: QueueMode) {}

  /** 入队消息
   * @param message 要添加的消息
   */
  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  /** 检查队列是否有消息
   * @returns 是否有待处理消息
   */
  hasItems(): boolean {
    return this.messages.length > 0;
  }

  /** 出队消息
   * @returns 消息数组，模式为 all 时返回全部，one-at-a-time 时返回一条
   */
  drain(): AgentMessage[] {
    if (this.mode === "all") {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }

    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  /** 清空队列 */
  clear(): void {
    this.messages = [];
  }
}

/** 活动运行状态 */
type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

/** Agent 构造选项 */
export interface AgentOptions {
  /** 初始状态 */
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  /** 将 Agent 消息转换为 LLM 消息格式 */
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** 消息转换/过滤函数 */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  /** 流函数 */
  streamFn?: StreamFn;
  /** 自定义 API Key 获取函数 */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /** 构建 system prompt 的函数 */
  buildSystemPrompt?: (context: AgentContext) => Promise<string[]>;
  /** 载荷回调函数 */
  onPayload?: SimpleStreamOptions["onPayload"];
  /** 工具执行前的钩子 */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /** 工具执行后的钩子 */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  /** 引导模式 */
  steeringMode?: QueueMode;
  /** 后续消息模式 */
  followUpMode?: QueueMode;
  /** 会话 ID */
  sessionId?: string;
  /** 思考预算 */
  thinkingBudgets?: ThinkingBudgets;
  /** 传输类型 */
  transport?: Transport;
  /** 最大重试延迟（毫秒） */
  maxRetryDelayMs?: number;
  /** 工具执行模式 */
  toolExecution?: ToolExecutionMode;
}

/**
 * Stateful Agent wrapper around the low-level agent loop.
 * 状态化 Agent，封装底层 agent loop
 */
export class Agent {
  private _state: MutableAgentState;
  private readonly listeners = new Set<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;

  /** 将 Agent 消息转换为 LLM 消息格式 */
  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** 消息转换/过滤函数 */
  public transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  /** 流函数 */
  public streamFn: StreamFn;
  /** 自定义 API Key 获取函数 */
  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /** 构建 system prompt 的函数 */
  public buildSystemPrompt?: (context: AgentContext) => Promise<string[]>;
  /** 载荷回调函数 */
  public onPayload?: SimpleStreamOptions["onPayload"];
  /** 工具执行前的钩子 */
  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /** 工具执行后的钩子 */
  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  private activeRun?: ActiveRun;
  /** 会话 ID */
  public sessionId?: string;
  /** 思考预算 */
  public thinkingBudgets?: ThinkingBudgets;
  /** 传输类型 */
  public transport: Transport;
  /** 最大重试延迟（毫秒） */
  public maxRetryDelayMs?: number;
  /** 工具执行模式 */
  public toolExecution: ToolExecutionMode;

  constructor(options: AgentOptions = {}) {
    this._state = createMutableAgentState(options.initialState);
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = options.transformContext;
    this.streamFn = options.streamFn ?? streamSimple;
    this.getApiKey = options.getApiKey;
    this.buildSystemPrompt = options.buildSystemPrompt;
    this.onPayload = options.onPayload;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
    this.sessionId = options.sessionId;
    this.thinkingBudgets = options.thinkingBudgets;
    this.transport = options.transport ?? "sse";
    this.maxRetryDelayMs = options.maxRetryDelayMs;
    this.toolExecution = options.toolExecution ?? "parallel";
  }

  /**
   * 订阅 agent 生命周期事件
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 当前 agent 状态
   */
  get state(): AgentState {
    return this._state;
  }

  /** 引导队列模式 */
  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  /** @returns 引导队列模式 */
  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  /** 后续消息队列模式 */
  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  /** @returns 后续消息队列模式 */
  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  /** 入队引导消息，在当前 assistant turn 结束后注入 */
  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  /** 入队后续消息，仅在 agent 停止后运行 */
  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  /** 清空引导队列 */
  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  /** 清空后续队列 */
  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  /** 清空所有队列 */
  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  /** 检查是否有队列消息
   * @returns 是否有待处理消息
   */
  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  /**
   * 当前运行的 abort 信号
   */
  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  /** 中止当前运行 */
  abort(): void {
    this.activeRun?.abortController.abort();
  }

  /**
   * 等待当前运行和所有事件监听器完成
   */
  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  /** 重置 transcript 状态、运行时状态和队列消息 */
  reset(): void {
    this._state.messages = [];
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this._state.errorMessage = undefined;
    this.clearFollowUpQueue();
    this.clearSteeringQueue();
  }

  /**
   * 从文本、单个消息或消息批次开始新 prompt
   * @param input 字符串或消息
   * @param images 可选的图片内容
   */
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
    if (this.activeRun) {
      throw new Error(
        "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
      );
    }
    const messages = this.normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
  }

  /**
   * 从当前 transcript 继续。最后一条消息必须是 user 或 tool-result 消息。
   */
  async continue(): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing. Wait for completion before continuing.");
    }

    const lastMessage = this._state.messages[this._state.messages.length - 1];
    if (!lastMessage) {
      throw new Error("No messages to continue from");
    }

    if (lastMessage.role === "assistant") {
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length > 0) {
        await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
        return;
      }

      const queuedFollowUps = this.followUpQueue.drain();
      if (queuedFollowUps.length > 0) {
        await this.runPromptMessages(queuedFollowUps);
        return;
      }

      throw new Error("Cannot continue from message role: assistant");
    }

    await this.runContinuation();
  }

  /** 标准化 prompt 输入为消息数组 */
  private normalizePromptInput(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): AgentMessage[] {
    if (Array.isArray(input)) {
      return input.slice();
    }

    if (typeof input !== "string") {
      return [input];
    }

    const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
    if (images && images.length > 0) {
      content.push(...images);
    }
    return [{ role: "user", content, timestamp: Date.now() }];
  }

  /** 运行 prompt 消息 */
  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        await this.createLoopConfig(options),
        (event) => this.processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  /** 继续运行 */
  private async runContinuation(): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        await this.createLoopConfig(),
        (event) => this.processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  /** 创建上下文快照 */
  private createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools.slice(),
    };
  }

  /** 创建循环配置 */
  private async createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): Promise<AgentLoopConfig> {
    let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
    return {
      model: this._state.model,
      reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
      sessionId: this.sessionId,
      onPayload: this.onPayload,
      transport: this.transport,
      thinkingBudgets: this.thinkingBudgets,
      maxRetryDelayMs: this.maxRetryDelayMs,
      toolExecution: this.toolExecution,
      beforeToolCall: this.beforeToolCall,
      afterToolCall: this.afterToolCall,
      convertToLlm: this.convertToLlm,
      transformContext: this.transformContext,
      getApiKey: this.getApiKey,
      systemPrompt: this.buildSystemPrompt
        ? await this.buildSystemPrompt(this.createContextSnapshot())
        : this._state.systemPrompt,
      getSteeringMessages: async () => {
        if (skipInitialSteeringPoll) {
          skipInitialSteeringPoll = false;
          return [];
        }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }

  /** 使用生命周期管理运行 */
  private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing.");
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.activeRun = { promise, resolve: resolvePromise, abortController };

    this._state.isStreaming = true;
    this._state.streamingMessage = undefined;
    this._state.errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (error) {
      await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this.finishRun();
    }
  }

  /** 处理运行失败 */
  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: this._state.model.api,
      provider: this._state.model.provider,
      model: this._state.model.id,
      usage: EMPTY_USAGE,
      stopReason: aborted ? "aborted" : "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } satisfies AgentMessage;
    this._state.messages = [...this._state.messages, failureMessage];
    this._state.errorMessage = failureMessage.errorMessage;
    await this.processEvents({ type: "agent_end", messages: [failureMessage] });
  }

  /** 完成运行 */
  private finishRun(): void {
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    this.activeRun = undefined;
  }

  /** 处理事件 */
  private async processEvents(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "message_start":
        this._state.streamingMessage = event.message;
        break;

      case "message_update":
        this._state.streamingMessage = event.message;
        break;

      case "message_end":
        this._state.streamingMessage = undefined;
        this._state.messages = [...this._state.messages, event.message];
        break;

      case "tool_execution_start": {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case "tool_execution_end": {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case "turn_end":
        if (event.message.role === "assistant" && event.message.errorMessage) {
          this._state.errorMessage = event.message.errorMessage;
        }
        break;

      case "agent_end":
        this._state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) {
      throw new Error("Agent listener invoked outside active run");
    }
    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
