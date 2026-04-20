// src/agent/session.ts
import { join } from "node:path";
import type { Model, SystemPrompt } from "../core/ai/index.js";
import { asSystemPrompt } from "../core/ai/index.js";
import { logger } from "../utils/logger.js";
import { Agent } from "./agent.js";
import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "./types.js";
import type { PromptCommand } from "../commands/types.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGlobTool, createSkillTool } from "./tools/index.js";
import { getCommands } from "../commands/index.js";
import type { SystemPromptContext } from "./system-prompt/types.js";
import { buildCodingAgentSystemPrompt } from "./system-prompt/coding-agent.js";

/** AgentSession 向 UI 层发出的事件 */
export type AgentSessionEvent =
  | { type: "turn_start"; modelName: string }
  | { type: "thinking_delta"; text: string; isFirst: boolean }
  | { type: "answer_delta"; text: string; isFirst: boolean }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown; isFirst: boolean }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string; timeMs: number }
  | { type: "turn_end"; tokens: number; cost: number; timeMs: number; errorMessage?: string };

/** AgentSession 构造选项 */
export interface AgentSessionOptions {
  /** 当前工作目录 */
  cwd: string;
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
  /** 思考级别 */
  thinkingLevel?: ThinkingLevel;
  /** 自定义 system prompt（不传则使用内置 coding-agent prompt） */
  systemPrompt?: (context: SystemPromptContext) => Promise<SystemPrompt>;
  /** 自定义工具列表（不传则使用默认的 read/write/edit/bash） */
  tools?: AgentTool<any, any>[];
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly cwd: string;
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  private readonly systemPromptBuilder: (context: SystemPromptContext) => Promise<SystemPrompt>;
  /** 会话 ID，用于标识一次会话 */
  private _sessionId = crypto.randomUUID();

  /** 会话 ID（只读） */
  get sessionId(): string {
    return this._sessionId;
  }
  private turnStartTime = 0;
  private toolStartTimes = new Map<string, number>();
  private hasEmittedThinking = false;
  private hasEmittedAnswer = false;
  private hasEmittedTools = false;
  private currentSystemPromptText = "";
  // SkillTool 初始化 Promise，用于在 prompt() 中等待初始化完成
  private skillToolInitPromise: Promise<void> | null = null;
  /** 已发送给 LLM 的 skill 名称集合（用于去重） */
  private sentSkillNames: Set<string> = new Set();

  /** 生成新 session ID */
  regenerateSessionId(): void {
    logger.info("Session ID regenerated");
    this._sessionId = crypto.randomUUID();
  }

  constructor(options: AgentSessionOptions) {
    this.cwd = options.cwd;
    const tools = options.tools ?? [
      createReadTool(options.cwd),
      createWriteTool(options.cwd),
      createEditTool(options.cwd),
      createBashTool(options.cwd),
      createGlobTool(options.cwd),
    ];
    this.agent = new Agent({
      systemPrompt: async () => asSystemPrompt([""]),
      initialState: {
        model: options.model,
        thinkingLevel: options.thinkingLevel ?? "medium",
        tools,
      },
      getApiKey: () => options.apiKey,
    });

    // 设置 sentSkillNames 用于去重
    this.agent.state.sentSkillNames = this.sentSkillNames;

    this.systemPromptBuilder = options.systemPrompt ?? buildCodingAgentSystemPrompt;

    this.agent.subscribe((event) => this.handleAgentEvent(event));

    // 异步初始化 SkillTool（不阻塞构造），保存 Promise 供 prompt() 等待
    this.skillToolInitPromise = this.initializeSkillTool();
  }

  /** 初始化 SkillTool（懒加载方式） */
  private async initializeSkillTool(): Promise<void> {
    try {
      // 传递 .claude/skills 作为 skillsBasePath 以定位 skills 目录
      const skillTool = createSkillTool(async () => getCommands(join(this.cwd, '.claude/skills')));
      this.agent.state.tools.push(skillTool);
      logger.debug("SkillTool registered", { toolName: skillTool.name });
    } catch (error) {
      logger.error("Failed to initialize SkillTool", { error });
    }
  }

  /** 获取尚未发送的 skills */
  getNewSkills(allSkills: PromptCommand[]): PromptCommand[] {
    return allSkills.filter((s) => !this.sentSkillNames.has(s.name));
  }

  /** 标记 skills 已发送 */
  markSkillsSent(skillNames: string[]): void {
    for (const name of skillNames) {
      this.sentSkillNames.add(name);
    }
  }

  /** 订阅 UI 事件 */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 当前消息列表（只读） */
  get messages(): readonly AgentMessage[] {
    return this.agent.state.messages;
  }

  /** 是否正在流式输出 */
  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /** 当前使用的模型 */
  get model(): Model<any> {
    return this.agent.state.model;
  }

  /** 当前可用工具列表（只读） */
  get tools(): readonly AgentTool<any, any>[] {
    return this.agent.state.tools;
  }

  /** 当前待执行的工具调用 ID 集合（只读） */
  get pendingToolCalls(): ReadonlySet<string> {
    return this.agent.state.pendingToolCalls;
  }

  /** 发送用户消息 */
  async prompt(text: string): Promise<void> {
    // 确保 SkillTool 已注册完成，避免竞态条件
    if (this.skillToolInitPromise) {
      await this.skillToolInitPromise;
      this.skillToolInitPromise = null;
    }
    logger.info("Turn started", { model: this.agent.state.model.name });
    await this.refreshSystemPrompt();
    await this.agent.prompt(text);
  }

  /** 注入引导消息 */
  steer(text: string): void {
    logger.debug("Steer message enqueued", { text });
    this.agent.steer({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  }

  /** 注入后续消息 */
  followUp(text: string): void {
    logger.debug("FollowUp message enqueued", { text });
    this.agent.followUp({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  }

  /** 重置会话 */
  reset(): void {
    logger.info("Session reset");
    this.agent.reset();
    this.clearTurnState();
  }

  private clearTurnState(): void {
    this.turnStartTime = 0;
    this.toolStartTimes.clear();
    this.hasEmittedThinking = false;
    this.hasEmittedAnswer = false;
    this.hasEmittedTools = false;
  }

  /** 中止当前运行 */
  abort(): void {
    logger.info("Session aborted");
    this.agent.abort();
  }

  /** 等待空闲 */
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  private async refreshSystemPrompt(): Promise<void> {
    const context: SystemPromptContext = {
      cwd: this.cwd,
      tools: this.agent.state.tools,
      model: this.agent.state.model,
    };
    const prompt = await this.systemPromptBuilder(context);
    logger.debug("System prompt refreshed", { prompt });
    this.agent.systemPrompt = async () => prompt;
    this.currentSystemPromptText = prompt.join("\n\n");
  }

  /** 获取当前 system prompt 文本 */
  getSystemPrompt(): string {
    return this.currentSystemPromptText;
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      // agent_start / agent_end 是 Agent 内部生命周期事件，UI 层通过 turn_start / turn_end 已足够感知状态变化，此处有意不转发
      case "agent_start":
      case "agent_end":
        return;
      case "turn_start": {
        this.clearTurnState();
        this.turnStartTime = Date.now();
        this.emit({ type: "turn_start", modelName: this.agent.state.model.name });
        break;
      }
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae.type === "thinking_delta") {
          const isFirst = !this.hasEmittedThinking;
          this.hasEmittedThinking = true;
          this.emit({ type: "thinking_delta", text: ae.delta, isFirst });
        } else if (ae.type === "text_delta") {
          const isFirst = !this.hasEmittedAnswer;
          this.hasEmittedAnswer = true;
          this.emit({ type: "answer_delta", text: ae.delta, isFirst });
        }
        break;
      }
      case "tool_execution_start": {
        this.toolStartTimes.set(event.toolCallId, Date.now());
        logger.info("Tool started", { toolName: event.toolName });
        const isFirst = !this.hasEmittedTools;
        this.hasEmittedTools = true;
        this.emit({
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          isFirst,
        });
        break;
      }
      case "tool_execution_end": {
        const startTime = this.toolStartTimes.get(event.toolCallId) ?? Date.now();
        this.toolStartTimes.delete(event.toolCallId);
        const summary = event.isError
          ? String((event.result as any)?.content?.[0]?.text ?? "error")
          : String((event.result as any)?.content?.[0]?.text ?? "");
        const elapsed = Date.now() - startTime;
        logger.info("Tool ended", { toolName: event.toolName, isError: event.isError, timeMs: elapsed });
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          summary: summary || "done",
          timeMs: elapsed,
        });
        break;
      }
      case "turn_end": {
        const elapsed = this.turnStartTime > 0 ? Date.now() - this.turnStartTime : 0;
        if (event.message.role === "assistant") {
          const usage = event.message.usage;
          logger.info("Turn ended", { tokens: usage.totalTokens, cost: usage.cost.total, timeMs: elapsed, error: event.message.errorMessage });
          this.emit({
            type: "turn_end",
            tokens: usage.totalTokens,
            cost: usage.cost.total,
            timeMs: elapsed,
            errorMessage: event.message.errorMessage,
          });
        } else {
          logger.info("Turn ended", { tokens: 0, cost: 0, timeMs: elapsed });
          this.emit({ type: "turn_end", tokens: 0, cost: 0, timeMs: elapsed });
        }
        break;
      }
    }
  }

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
