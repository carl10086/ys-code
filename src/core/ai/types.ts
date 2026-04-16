import type { AssistantMessageEventStream } from "./utils/event-stream.js";

export type { AssistantMessageEventStream } from "./utils/event-stream.js";

export type KnownApi = "anthropic-messages";
export type Api = KnownApi | (string & {});

export type KnownProvider = "minimax" | "minimax-cn";
export type Provider = KnownProvider | string;

export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/** 各 reasoning 等级的 token 预算（仅基于 token 的 provider 使用） */
export interface ThinkingBudgets {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export type CacheRetention = "none" | "short" | "long";
export type Transport = "sse" | "websocket" | "auto";

export interface StreamOptions {
	/** 温度 */
	temperature?: number;
	/** 最大生成 token 数 */
	maxTokens?: number;
	/** 取消信号 */
	signal?: AbortSignal;
	/** API 密钥 */
	apiKey?: string;
	/** 优先传输方式 */
	transport?: Transport;
	/** 缓存保留偏好 */
	cacheRetention?: CacheRetention;
	/** 会话标识 */
	sessionId?: string;
	/** 请求前修改 payload 的回调 */
	onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
	/** 自定义 HTTP 请求头 */
	headers?: Record<string, string>;
	/** 最大重试等待时间（毫秒） */
	maxRetryDelayMs?: number;
	/** 请求元数据 */
	metadata?: Record<string, unknown>;
}

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>;

export interface SimpleStreamOptions extends StreamOptions {
	/** reasoning 等级 */
	reasoning?: ThinkingLevel;
	/** 自定义 thinking token 预算 */
	thinkingBudgets?: ThinkingBudgets;
}

export type StreamFunction<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> = (
	model: Model<TApi>,
	context: Context,
	options?: TOptions,
) => AssistantMessageEventStream;

export interface TextSignatureV1 {
	v: 1;
	id: string;
	phase?: "commentary" | "final_answer";
}

export interface TextContent {
	type: "text";
	/** 文本内容 */
	text: string;
	textSignature?: string;
}

export interface ThinkingContent {
	type: "thinking";
	/** thinking 文本 */
	thinking: string;
	thinkingSignature?: string;
	/** 是否被安全过滤器屏蔽 */
	redacted?: boolean;
}

export interface ImageContent {
	type: "image";
	/** base64 编码的图片数据 */
	data: string;
	/** MIME 类型，如 image/jpeg */
	mimeType: string;
}

export interface ToolCall {
	type: "toolCall";
	/** 调用 ID */
	id: string;
	/** 工具名称 */
	name: string;
	/** 参数 */
	arguments: Record<string, any>;
	thoughtSignature?: string;
}

export interface Usage {
	/** 输入 token 数 */
	input: number;
	/** 输出 token 数 */
	output: number;
	/** 缓存读取 token 数 */
	cacheRead: number;
	/** 缓存写入 token 数 */
	cacheWrite: number;
	/** 总 token 数 */
	totalTokens: number;
	/** 费用估算（美元） */
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	/** 时间戳（毫秒） */
	timestamp: number;
}

/** 角色常量 */
export const ROLE = {
	USER: "user",
	ASSISTANT: "assistant",
	TOOL_RESULT: "toolResult",
	SYSTEM: "system",
	TOOL: "tool",
} as const;

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: Provider;
	model: string;
	responseId?: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage<TDetails = any> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError: boolean;
	/** 时间戳（毫秒） */
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

import type { TSchema } from "@sinclair/typebox";

export interface Tool<TParameters extends TSchema = TSchema> {
	/** 工具名称 */
	name: string;
	/** 工具描述 */
	description: string;
	/** 参数定义（TypeBox JSON Schema） */
	parameters: TParameters;
}

export interface Context {
	/** 系统提示词 */
	systemPrompt?: string | string[];
	/** 消息列表 */
	messages: Message[];
	/** 工具列表 */
	tools?: Tool[];
}

export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
	| { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

export interface OpenAICompletionsCompat {
	supportsStore?: boolean;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	reasoningEffortMap?: Partial<Record<ThinkingLevel, string>>;
	supportsUsageInStreaming?: boolean;
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	requiresToolResultName?: boolean;
	requiresAssistantAfterToolResult?: boolean;
	requiresThinkingAsText?: boolean;
	thinkingFormat?: "openai" | "openrouter" | "zai" | "qwen" | "qwen-chat-template";
}

export interface OpenAIResponsesCompat {
	// 预留
}

export interface Model<TApi extends Api> {
	/** 模型 ID */
	id: string;
	/** 展示名称 */
	name: string;
	/** API 类型 */
	api: TApi;
	/** Provider 名称 */
	provider: Provider;
	/** 基础 URL */
	baseUrl: string;
	/** 是否支持 reasoning */
	reasoning: boolean;
	/** 支持的输入类型 */
	input: ("text" | "image")[];
	/** 费用（每百万 token 美元） */
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	/** 上下文窗口大小 */
	contextWindow: number;
	/** 最大输出 token 数 */
	maxTokens: number;
	/** 默认请求头 */
	headers?: Record<string, string>;
	/** 兼容性覆盖 */
	compat?: TApi extends "openai-completions" ? OpenAICompletionsCompat : TApi extends "openai-responses" ? OpenAIResponsesCompat : never;
}
