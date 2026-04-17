// src/agent/session.ts
import type { Model, SystemPrompt } from "../core/ai/index.js";
import { asSystemPrompt } from "../core/ai/index.js";
import { Agent } from "./agent.js";
import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "./types.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "./tools/index.js";
import { createSystemPromptBuilder } from "./system-prompt/systemPrompt.js";
import type { SystemPromptContext, SystemPromptSection } from "./system-prompt/types.js";

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
  /** 简单系统提示字符串（与 systemPromptSections 二选一） */
  systemPrompt?: string;
  /** system prompt sections，用于 createSystemPromptBuilder（与 systemPrompt 二选一） */
  systemPromptSections?: SystemPromptSection[];
  /** 自定义工具列表（不传则使用默认的 read/write/edit/bash） */
  tools?: AgentTool<any, any>[];
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly cwd: string;
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  private readonly systemPromptBuilder: (context: SystemPromptContext) => Promise<SystemPrompt>;
  private turnStartTime = 0;
  private toolStartTimes = new Map<string, number>();
  private hasEmittedThinking = false;
  private hasEmittedAnswer = false;
  private hasEmittedTools = false;

  constructor(options: AgentSessionOptions) {
    this.cwd = options.cwd;
    const tools = options.tools ?? [
      createReadTool(options.cwd),
      createWriteTool(options.cwd),
      createEditTool(options.cwd),
      createBashTool(options.cwd),
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

    if (options.systemPromptSections && options.systemPrompt) {
      throw new Error("Cannot provide both systemPrompt and systemPromptSections");
    }
    if (options.systemPromptSections) {
      this.systemPromptBuilder = createSystemPromptBuilder(options.systemPromptSections);
    } else {
      const staticPrompt = asSystemPrompt([options.systemPrompt ?? ""]);
      this.systemPromptBuilder = async () => staticPrompt;
    }

    this.agent.subscribe((event) => this.handleAgentEvent(event));
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
    await this.refreshSystemPrompt();
    await this.agent.prompt(text);
  }

  /** 注入引导消息 */
  steer(text: string): void {
    this.agent.steer({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  }

  /** 注入后续消息 */
  followUp(text: string): void {
    this.agent.followUp({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  }

  /** 重置会话 */
  reset(): void {
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
    this.agent.systemPrompt = async () => prompt;
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
          this.emit({
            type: "turn_end",
            tokens: usage.totalTokens,
            cost: usage.cost.total,
            timeMs: elapsed,
            errorMessage: event.message.errorMessage,
          });
        } else {
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
