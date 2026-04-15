// src/agent/types.ts
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
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

/** 阻止工具执行的结果 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

/** afterToolCall 可覆盖的字段 */
export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
}

/** beforeToolCall 上下文 */
export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  context: AgentContext;
}

/** afterToolCall 上下文 */
export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult<unknown>;
  isError: boolean;
  context: AgentContext;
}

/** thinking 等级 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** 自定义消息扩展接口（通过 declaration merging 扩展） */
export interface CustomAgentMessages {}

/** Agent 消息类型 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/** 工具执行结果 */
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}

/** 工具定义 */
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string;
  description: string;
  parameters: TParameters;
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void,
  ) => Promise<AgentToolResult<TDetails>>;
}

/** Agent 上下文快照 */
export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}

/** Agent 公开状态 */
export interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}

/** Agent 事件类型 */
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

/** AgentLoop 配置 */
export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode;
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}
