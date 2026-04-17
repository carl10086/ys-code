// src/agent/types.ts
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  SystemPrompt,
  TextContent,
  ToolResultMessage,
} from "../core/ai/index.js";
import type { Static, TSchema } from "@sinclair/typebox";

/** 流函数类型 */
export type StreamFn = (
  ...args: Parameters<typeof import("../core/ai/index.js").streamSimple>
) => ReturnType<typeof import("../core/ai/index.js").streamSimple>;

/** 工具执行模式 */
export type ToolExecutionMode = "sequential" | "parallel";

/** Agent toolCall 类型 */
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/** thinking 等级 */
export type ThinkingLevel =
  | "off"   // 不使用 thinking
  | "minimal"   // 极简 thinking，仅最终答案
  | "low"   // 低级别 thinking
  | "medium"   // 中等级别 thinking（平衡速度和深度）
  | "high"   // 高级别 thinking（更深入分析）
  | "xhigh";   // 极高 thinking（最深度推理）

/** 自定义消息扩展接口（通过 declaration merging 扩展） */
export interface CustomAgentMessages {}

/** Agent 消息类型 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/** 工具执行结果
 * @template T 详细信息类型
 */
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}

/** 工具执行上下文 */
export interface ToolUseContext {
  /** 中止信号 */
  abortSignal: AbortSignal;
  /** 当前会话消息列表 */
  messages: AgentMessage[];
  /** 当前可用工具列表 */
  tools: AgentTool<any, any>[];
  /** 会话 ID */
  sessionId?: string;
  /** 当前模型 */
  model?: Model<any>;
}

/** 工具定义 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TOutput = unknown,
> {
  /** 工具名称 */
  name: string;

  /**
   * 工具描述。
   * - 若为 string，则作为静态描述直接使用
   * - 若为函数，则根据输入参数和上下文动态生成最终描述
   */
  description:
    | string
    | ((params: Static<TParameters>, context: ToolUseContext) => string | Promise<string>);

  /** 输入参数 schema（TypeBox） */
  parameters: TParameters;

  /** 结构化输出 schema（TypeBox） */
  outputSchema: TSchema;

  /** 显示标签 */
  label: string;

  /** 参数预处理：将 LLM 原始参数转换为符合 schema 的输入 */
  prepareArguments?: (args: unknown) => Static<TParameters>;

  /**
   * 参数校验（在权限检查前调用）。
   * 用于执行 Tool 级别的参数合法性验证。
   */
  validateInput?: (
    params: Static<TParameters>,
    context: ToolUseContext,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;

  /**
   * 权限检查（在 validateInput 通过后调用）。
   * 用于执行 Tool 级别的权限决策。
   */
  checkPermissions?: (
    params: Static<TParameters>,
    context: ToolUseContext,
  ) => Promise<{ allowed: true } | { allowed: false; reason: string }>;

  /**
   * 执行工具，返回原始业务输出。
   * tool-execution.ts 会负责调用 formatResult 将其转为 LLM 内容。
   */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    context: ToolUseContext,
    onUpdate?: (partialOutput: TOutput) => void,
  ) => Promise<TOutput>;

  /**
   * 将执行结果格式化为 LLM 可用的内容。
   * 若未提供，则由 tool-execution.ts 提供默认 fallback（String(output) 转文本）。
   */
  formatResult?: (
    output: TOutput,
    toolCallId: string,
  ) => (TextContent | ImageContent)[] | string;

  /** 是否为只读操作 */
  isReadOnly?: boolean;

  /** 是否支持并发执行 */
  isConcurrencySafe?: boolean;

  /** 是否为破坏性操作（如删除、覆盖、发送） */
  isDestructive?: boolean;
}

/** Agent 上下文快照 */
export interface AgentContext {
  messages: AgentMessage[];
  tools?: AgentTool<any, any>[];
}

/** Agent 公开状态 */
export interface AgentState {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any, any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}

/** Agent 事件类型 */
export type AgentEvent =
  | { type: "agent_start" }   // Agent 开始
  | { type: "agent_end"; messages: AgentMessage[] }   // Agent 结束
  | { type: "turn_start" }   // 轮次开始
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }   // 轮次结束
  | { type: "message_start"; message: AgentMessage }   // 消息开始
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }   // 消息更新
  | { type: "message_end"; message: AgentMessage }   // 消息结束
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }   // 工具执行开始
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }   // 工具执行进度更新
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };   // 工具执行结束

/** AgentLoop 配置 */
export interface AgentLoopConfig extends SimpleStreamOptions {
  /** 系统提示词 */
  systemPrompt?: SystemPrompt;
  model: Model<any>;   // 使用的 AI 模型
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;   // 将 Agent 消息转换为 LLM 消息格式
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;   // 可选的消息转换/过滤函数
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;   // 可选的自定义 API Key 获取函数
  getSteeringMessages?: () => Promise<AgentMessage[]>;   // 可选的引导消息获取函数
  getFollowUpMessages?: () => Promise<AgentMessage[]>;   // 可选的后续消息获取函数
  toolExecution?: ToolExecutionMode;   // 工具执行模式（sequential/parallel）
}
