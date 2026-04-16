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

/** 工具定义 */
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  description: string;
  parameters: TParameters;
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  /** 执行工具
   * @param toolCallId 工具调用唯一标识
   * @param params 经过 prepareArguments 处理后的参数
   * @param signal 可选的 abort 信号
   * @param onUpdate 可选的进度回调
   */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void,
  ) => Promise<AgentToolResult<TDetails>>;
}

/** Agent 上下文快照 */
export interface AgentContext {
  /** 系统提示词 */
  systemPrompt: SystemPrompt;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}

/** Agent 公开状态 */
export interface AgentState {
  /** 系统提示词 */
  systemPrompt: SystemPrompt;
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
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;   // 工具执行前的钩子，可阻止或修改行为
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;   // 工具执行后的钩子，可覆盖结果
}
