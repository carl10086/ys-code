# MiniMax AI 层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `pi-mono/packages/ai` 的完整抽象层移植到 `ys-code` 的 `src/core/ai` 目录下，仅保留 MiniMax provider 支持。

**架构：** 保留 pi-mono 的通用类型系统、API 注册表、事件流协议和模型注册表，裁剪掉所有其他 provider 实现及无关模块（OAuth/CLI/测试/Bedrock 等）。MiniMax 通过 `anthropic-messages` API 协议接入，由简化后的 `anthropic.ts` provider 统一处理。

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/sdk`, `@sinclair/typebox`, `ajv`, `ajv-formats`, `partial-json`

---

## 文件结构说明

| 文件 | 职责 |
|------|------|
| `src/core/ai/utils/event-stream.ts` | 异步事件流基类与 `AssistantMessageEventStream` |
| `src/core/ai/utils/json-parse.ts` | 流式 JSON 解析（依赖 `partial-json`） |
| `src/core/ai/utils/hash.ts` | 短哈希工具 |
| `src/core/ai/utils/sanitize-unicode.ts` | 去除未配对 Unicode surrogate |
| `src/core/ai/utils/overflow.ts` | 上下文溢出错误检测 |
| `src/core/ai/types.ts` | 消息、模型、流选项、事件类型定义 |
| `src/core/ai/models.generated.ts` | 仅 minimax / minimax-cn 的模型静态数据 |
| `src/core/ai/models.ts` | 模型注册表 API：`getModel` / `getModels` / `calculateCost` |
| `src/core/ai/api-registry.ts` | 按 `api` 类型注册 provider |
| `src/core/ai/env-api-keys.ts` | 从环境变量读取 API key，仅保留 minimax 映射 |
| `src/core/ai/providers/simple-options.ts` | 构建通用流选项、thinking 预算计算 |
| `src/core/ai/providers/transform-messages.ts` | 跨 provider 消息规范化与 tool call ID 处理 |
| `src/core/ai/providers/anthropic.ts` | Anthropic Messages API provider（简化版，去除 OAuth/Copilot） |
| `src/core/ai/providers/register-builtins.ts` | 懒加载注册 `anthropic-messages` provider |
| `src/core/ai/stream.ts` | `stream` / `complete` / `streamSimple` / `completeSimple` |
| `src/core/ai/index.ts` | 统一对外导出 |

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

**Goal:** 添加 `@anthropic-ai/sdk`、`@sinclair/typebox`、`ajv`、`ajv-formats`、`partial-json`。

- [ ] **Step 1: 安装 npm 依赖包**

```bash
bun add @anthropic-ai/sdk @sinclair/typebox ajv ajv-formats partial-json
```

Expected: 命令成功执行，`package.json` 和 `bun.lock` 被更新。

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add @anthropic-ai/sdk, typebox, ajv, ajv-formats, partial-json for ai layer"
```

---

### Task 2: 创建事件流工具

**Files:**
- Create: `src/core/ai/utils/event-stream.ts`

- [ ] **Step 1: 创建 `src/core/ai/utils/event-stream.ts`**

```typescript
import type { AssistantMessage, AssistantMessageEvent } from "../types.js";

// 通用异步事件流类
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: ((value: IteratorResult<T>) => void)[] = [];
	private done = false;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;

	constructor(
		private isComplete: (event: T) => boolean,
		private extractResult: (event: T) => R,
	) {
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: T): void {
		if (this.done) return;

		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}

		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(result?: R): void {
		this.done = true;
		if (result !== undefined) {
			this.resolveFinalResult(result);
		}
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter({ value: undefined as any, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
				if (result.done) return;
				yield result.value;
			}
		}
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				} else if (event.type === "error") {
					return event.error;
				}
				throw new Error("Unexpected event type for final result");
			},
		);
	}
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/ai/utils/event-stream.ts
git commit -m "feat(ai): add AssistantMessageEventStream"
```

---

### Task 3: 创建小型工具函数

**Files:**
- Create: `src/core/ai/utils/json-parse.ts`
- Create: `src/core/ai/utils/hash.ts`
- Create: `src/core/ai/utils/sanitize-unicode.ts`
- Create: `src/core/ai/utils/overflow.ts`

- [ ] **Step 1: 创建 `src/core/ai/utils/json-parse.ts`**

```typescript
import { parse as partialParse } from "partial-json";

export function parseStreamingJson<T = any>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}
	try {
		return JSON.parse(partialJson) as T;
	} catch {
		try {
			const result = partialParse(partialJson);
			return (result ?? {}) as T;
		} catch {
			return {} as T;
		}
	}
}
```

- [ ] **Step 2: 创建 `src/core/ai/utils/hash.ts`**

```typescript
export function shortHash(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
```

- [ ] **Step 3: 创建 `src/core/ai/utils/sanitize-unicode.ts`**

```typescript
export function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
```

- [ ] **Step 4: 创建 `src/core/ai/utils/overflow.ts`**

```typescript
import type { AssistantMessage } from "../types.js";

const OVERFLOW_PATTERNS = [
	/prompt is too long/i,
	/request_too_large/i,
	/input is too long for requested model/i,
	/exceeds the context window/i,
	/input token count.*exceeds the maximum/i,
	/maximum prompt length is \d+/i,
	/reduce the length of the messages/i,
	/maximum context length is \d+ tokens/i,
	/exceeds the limit of \d+/i,
	/exceeds the available context size/i,
	/greater than the context length/i,
	/context window exceeds limit/i,
	/exceeded model token limit/i,
	/too large for model with \d+ maximum context length/i,
	/model_context_window_exceeded/i,
	/prompt too long; exceeded (?:max )?context length/i,
	/context[_ ]length[_ ]exceeded/i,
	/too many tokens/i,
	/token limit exceeded/i,
	/^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
];

const NON_OVERFLOW_PATTERNS = [
	/^(Throttling error|Service unavailable):/i,
	/rate limit/i,
	/too many requests/i,
];

export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
	if (message.stopReason === "error" && message.errorMessage) {
		const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!));
		if (!isNonOverflow && OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!))) {
			return true;
		}
	}
	if (contextWindow && message.stopReason === "stop") {
		const inputTokens = message.usage.input + message.usage.cacheRead;
		if (inputTokens > contextWindow) {
			return true;
		}
	}
	return false;
}

export function getOverflowPatterns(): RegExp[] {
	return [...OVERFLOW_PATTERNS];
}
```

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/utils/json-parse.ts src/core/ai/utils/hash.ts src/core/ai/utils/sanitize-unicode.ts src/core/ai/utils/overflow.ts
git commit -m "feat(ai): add json-parse, hash, sanitize-unicode, overflow utilities"
```

---

### Task 4: 创建统一类型定义

**Files:**
- Create: `src/core/ai/types.ts`

- [ ] **Step 1: 创建 `src/core/ai/types.ts`**

```typescript
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
	systemPrompt?: string;
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
```

- [ ] **Step 2: Commit**

```bash
git add src/core/ai/types.ts
git commit -m "feat(ai): add unified types for messages, models, and streaming"
```

---

### Task 5: 创建模型注册系统

**Files:**
- Create: `src/core/ai/models.generated.ts`
- Create: `src/core/ai/models.ts`

- [ ] **Step 1: 创建 `src/core/ai/models.generated.ts`**

```typescript
import type { Model } from "./types.js";

export const MODELS = {
	minimax: {
		"MiniMax-M2.7": {
			id: "MiniMax-M2.7",
			name: "MiniMax-M2.7",
			api: "anthropic-messages",
			provider: "minimax",
			baseUrl: "https://api.minimax.io/anthropic",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.3,
				output: 1.2,
				cacheRead: 0.06,
				cacheWrite: 0.375,
			},
			contextWindow: 204800,
			maxTokens: 131072,
		} satisfies Model<"anthropic-messages">,
		"MiniMax-M2.7-highspeed": {
			id: "MiniMax-M2.7-highspeed",
			name: "MiniMax-M2.7-highspeed",
			api: "anthropic-messages",
			provider: "minimax",
			baseUrl: "https://api.minimax.io/anthropic",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.6,
				output: 2.4,
				cacheRead: 0.06,
				cacheWrite: 0.375,
			},
			contextWindow: 204800,
			maxTokens: 131072,
		} satisfies Model<"anthropic-messages">,
	},
	"minimax-cn": {
		"MiniMax-M2.7": {
			id: "MiniMax-M2.7",
			name: "MiniMax-M2.7",
			api: "anthropic-messages",
			provider: "minimax-cn",
			baseUrl: "https://api.minimaxi.com/anthropic",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.3,
				output: 1.2,
				cacheRead: 0.06,
				cacheWrite: 0.375,
			},
			contextWindow: 204800,
			maxTokens: 131072,
		} satisfies Model<"anthropic-messages">,
		"MiniMax-M2.7-highspeed": {
			id: "MiniMax-M2.7-highspeed",
			name: "MiniMax-M2.7-highspeed",
			api: "anthropic-messages",
			provider: "minimax-cn",
			baseUrl: "https://api.minimaxi.com/anthropic",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.6,
				output: 2.4,
				cacheRead: 0.06,
				cacheWrite: 0.375,
			},
			contextWindow: 204800,
			maxTokens: 131072,
		} satisfies Model<"anthropic-messages">,
	},
} as const;
```

- [ ] **Step 2: 创建 `src/core/ai/models.ts`**

```typescript
import { MODELS } from "./models.generated.js";
import type { Api, KnownProvider, Model, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as Model<Api>);
	}
	modelRegistry.set(provider, providerModels);
}

type ModelApi<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]> =
	(typeof MODELS)[TProvider][TModelId] extends { api: infer TApi }
		? TApi extends Api
			? TApi
			: never
		: never;

export function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId as string) as Model<ModelApi<TProvider, TModelId>>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = modelRegistry.get(provider);
	return models ? (Array.from(models.values()) as Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[]) : [];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
	if (model.id.includes("gpt-5.2") || model.id.includes("gpt-5.3") || model.id.includes("gpt-5.4")) {
		return true;
	}
	if (model.id.includes("opus-4-6") || model.id.includes("opus-4.6")) {
		return true;
	}
	return false;
}

export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/ai/models.generated.ts src/core/ai/models.ts
git commit -m "feat(ai): add model registry with minimax and minimax-cn models"
```

---

### Task 6: 创建 API 注册表和密钥管理

**Files:**
- Create: `src/core/ai/api-registry.ts`
- Create: `src/core/ai/env-api-keys.ts`

- [ ] **Step 1: 创建 `src/core/ai/api-registry.ts`**

```typescript
import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "./types.js";

export type ApiStreamFunction = (
	model: Model<Api>,
	context: Context,
	options?: StreamOptions,
) => AssistantMessageEventStream;

export type ApiStreamSimpleFunction = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ApiProvider<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	api: TApi;
	stream: StreamFunction<TApi, TOptions>;
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

interface ApiProviderInternal {
	api: Api;
	stream: ApiStreamFunction;
	streamSimple: ApiStreamSimpleFunction;
}

type RegisteredApiProvider = {
	provider: ApiProviderInternal;
	sourceId?: string;
};

const apiProviderRegistry = new Map<string, RegisteredApiProvider>();

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	stream: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return stream(model as Model<TApi>, context, options as TOptions);
	};
}

function wrapStreamSimple<TApi extends Api>(
	api: TApi,
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>,
): ApiStreamSimpleFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return streamSimple(model as Model<TApi>, context, options);
	};
}

export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
	provider: ApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	apiProviderRegistry.set(provider.api, {
		provider: {
			api: provider.api,
			stream: wrapStream(provider.api, provider.stream),
			streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
		},
		sourceId,
	});
}

export function getApiProvider(api: Api): ApiProviderInternal | undefined {
	return apiProviderRegistry.get(api)?.provider;
}

export function getApiProviders(): ApiProviderInternal[] {
	return Array.from(apiProviderRegistry.values(), (entry) => entry.provider);
}

export function unregisterApiProviders(sourceId: string): void {
	for (const [api, entry] of apiProviderRegistry.entries()) {
		if (entry.sourceId === sourceId) {
			apiProviderRegistry.delete(api);
		}
	}
}

export function clearApiProviders(): void {
	apiProviderRegistry.clear();
}
```

- [ ] **Step 2: 创建 `src/core/ai/env-api-keys.ts`**

```typescript
import type { KnownProvider } from "./types.js";

export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: any): string | undefined {
	const envMap: Record<string, string> = {
		minimax: "MINIMAX_API_KEY",
		"minimax-cn": "MINIMAX_CN_API_KEY",
	};
	const envVar = envMap[provider];
	return envVar ? process.env[envVar] : undefined;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/ai/api-registry.ts src/core/ai/env-api-keys.ts
git commit -m "feat(ai): add api registry and env api key resolver"
```

---

### Task 7: 创建 Provider 辅助文件

**Files:**
- Create: `src/core/ai/providers/simple-options.ts`
- Create: `src/core/ai/providers/transform-messages.ts`

- [ ] **Step 1: 创建 `src/core/ai/providers/simple-options.ts`**

```typescript
import type { Api, Model, SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel } from "../types.js";

export function buildBaseOptions(model: Model<Api>, options?: SimpleStreamOptions, apiKey?: string): StreamOptions {
	return {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
	};
}

export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh"> | undefined {
	return effort === "xhigh" ? "high" : effort;
}

export function adjustMaxTokensForThinking(
	baseMaxTokens: number,
	modelMaxTokens: number,
	reasoningLevel: ThinkingLevel,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	const defaultBudgets: ThinkingBudgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
	};
	const budgets = { ...defaultBudgets, ...customBudgets };
	const minOutputTokens = 1024;
	const level = clampReasoning(reasoningLevel)!;
	let thinkingBudget = budgets[level]!;
	const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);
	if (maxTokens <= thinkingBudget) {
		thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	}
	return { maxTokens, thinkingBudget };
}
```

- [ ] **Step 2: 创建 `src/core/ai/providers/transform-messages.ts`**

```typescript
import type { Api, AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "../types.js";

export function transformMessages<TApi extends Api>(
	messages: Message[],
	model: Model<TApi>,
	normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
	const toolCallIdMap = new Map<string, string>();

	const transformed = messages.map((msg) => {
		if (msg.role === "user") {
			return msg;
		}
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) {
				return { ...msg, toolCallId: normalizedId };
			}
			return msg;
		}
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			const isSameModel =
				assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;

			const transformedContent = assistantMsg.content.flatMap((block) => {
				if (block.type === "thinking") {
					if (block.redacted) {
						return isSameModel ? block : [];
					}
					if (isSameModel && block.thinkingSignature) return block;
					if (!block.thinking || block.thinking.trim() === "") return [];
					if (isSameModel) return block;
					return { type: "text" as const, text: block.thinking };
				}
				if (block.type === "text") {
					if (isSameModel) return block;
					return { type: "text" as const, text: block.text };
				}
				if (block.type === "toolCall") {
					const toolCall = block as ToolCall;
					let normalizedToolCall: ToolCall = toolCall;
					if (!isSameModel && toolCall.thoughtSignature) {
						normalizedToolCall = { ...toolCall };
						delete (normalizedToolCall as { thoughtSignature?: string }).thoughtSignature;
					}
					if (!isSameModel && normalizeToolCallId) {
						const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
						}
					}
					return normalizedToolCall;
				}
				return block;
			});

			return { ...assistantMsg, content: transformedContent };
		}
		return msg;
	});

	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	let existingToolResultIds = new Set<string>();

	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];
		if (msg.role === "assistant") {
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}
			const assistantMsg = msg as AssistantMessage;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				continue;
			}
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "user") {
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else {
			result.push(msg);
		}
	}

	return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/ai/providers/simple-options.ts src/core/ai/providers/transform-messages.ts
git commit -m "feat(ai): add provider helpers for options and message transformation"
```

---

### Task 8: 创建 Anthropic Provider 实现

**Files:**
- Create: `src/core/ai/providers/anthropic.ts`

- [ ] **Step 1: 创建 `src/core/ai/providers/anthropic.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { getEnvApiKey } from "../env-api-keys.js";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { adjustMaxTokensForThinking, buildBaseOptions } from "./simple-options.js";
import { transformMessages } from "./transform-messages.js";

function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) return cacheRetention;
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
		return "long";
	}
	return "short";
}

function getCacheControl(
	baseUrl: string,
	cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: { type: "ephemeral"; ttl?: "1h" } } {
	const retention = resolveCacheRetention(cacheRetention);
	if (retention === "none") {
		return { retention };
	}
	const ttl = retention === "long" && baseUrl.includes("api.anthropic.com") ? "1h" : undefined;
	return {
		retention,
		cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
	};
}

function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}
	const blocks = content.map((block) => {
		if (block.type === "text") {
			return { type: "text" as const, text: sanitizeSurrogates(block.text) };
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});
	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({ type: "text" as const, text: "(see attached image)" });
	}
	return blocks;
}

export type AnthropicEffort = "low" | "medium" | "high" | "max";

export interface AnthropicOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	effort?: AnthropicEffort;
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	client?: Anthropic;
}

function mergeHeaders(...headerSources: (Record<string, string> | undefined)[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}
	return merged;
}

export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			let client: Anthropic;
			if (options?.client) {
				client = options.client;
			} else {
				const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
				client = createClient(model, apiKey, options?.headers);
			}
			let params = buildParams(model, context, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) {
				params = nextParams as MessageCreateParamsStreaming;
			}
			const anthropicStream = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];

			for await (const event of anthropicStream) {
				if (event.type === "message_start") {
					output.responseId = event.message.id;
					output.usage.input = event.message.usage.input_tokens || 0;
					output.usage.output = event.message.usage.output_tokens || 0;
					output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
					output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				} else if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						const block: Block = { type: "text", text: "", index: event.index };
						output.content.push(block);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "thinking") {
						const block: Block = { type: "thinking", thinking: "", thinkingSignature: "", index: event.index };
						output.content.push(block);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "redacted_thinking") {
						const block: Block = {
							type: "thinking",
							thinking: "[Reasoning redacted]",
							thinkingSignature: event.content_block.data,
							redacted: true,
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "tool_use") {
						const block: Block = {
							type: "toolCall",
							id: event.content_block.id,
							name: event.content_block.name,
							arguments: (event.content_block.input as Record<string, any>) ?? {},
							partialJson: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
				} else if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "text") {
							block.text += event.delta.text;
							stream.push({ type: "text_delta", contentIndex: index, delta: event.delta.text, partial: output });
						}
					} else if (event.delta.type === "thinking_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinking += event.delta.thinking;
							stream.push({
								type: "thinking_delta",
								contentIndex: index,
								delta: event.delta.thinking,
								partial: output,
							});
						}
					} else if (event.delta.type === "input_json_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "toolCall") {
							block.partialJson += event.delta.partial_json;
							block.arguments = parseStreamingJson(block.partialJson);
							stream.push({
								type: "toolcall_delta",
								contentIndex: index,
								delta: event.delta.partial_json,
								partial: output,
							});
						}
					} else if (event.delta.type === "signature_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinkingSignature = block.thinkingSignature || "";
							block.thinkingSignature += event.delta.signature;
						}
					}
				} else if (event.type === "content_block_stop") {
					const index = blocks.findIndex((b) => b.index === event.index);
					const block = blocks[index];
					if (block) {
						delete (block as any).index;
						if (block.type === "text") {
							stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
						} else if (block.type === "thinking") {
							stream.push({
								type: "thinking_end",
								contentIndex: index,
								content: block.thinking,
								partial: output,
							});
						} else if (block.type === "toolCall") {
							block.arguments = parseStreamingJson(block.partialJson);
							delete (block as any).partialJson;
							stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
						}
					}
				} else if (event.type === "message_delta") {
					if (event.delta.stop_reason) {
						output.stopReason = mapStopReason(event.delta.stop_reason);
					}
					if (event.usage.input_tokens != null) {
						output.usage.input = event.usage.input_tokens;
					}
					if (event.usage.output_tokens != null) {
						output.usage.output = event.usage.output_tokens;
					}
					if (event.usage.cache_read_input_tokens != null) {
						output.usage.cacheRead = event.usage.cache_read_input_tokens;
					}
					if (event.usage.cache_creation_input_tokens != null) {
						output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
					}
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function supportsAdaptiveThinking(modelId: string): boolean {
	return (
		modelId.includes("opus-4-6") ||
		modelId.includes("opus-4.6") ||
		modelId.includes("sonnet-4-6") ||
		modelId.includes("sonnet-4.6")
	);
}

function mapThinkingLevelToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): AnthropicEffort {
	switch (level) {
		case "minimal":
			return "low";
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return modelId.includes("opus-4-6") || modelId.includes("opus-4.6") ? "max" : "high";
		default:
			return "high";
	}
}

export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamAnthropic(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
	}

	if (supportsAdaptiveThinking(model.id)) {
		const effort = mapThinkingLevelToEffort(options.reasoning, model.id);
		return streamAnthropic(model, context, { ...base, thinkingEnabled: true, effort } satisfies AnthropicOptions);
	}

	const adjusted = adjustMaxTokensForThinking(
		base.maxTokens || 0,
		model.maxTokens,
		options.reasoning,
		options.thinkingBudgets,
	);

	return streamAnthropic(model, context, {
		...base,
		maxTokens: adjusted.maxTokens,
		thinkingEnabled: true,
		thinkingBudgetTokens: adjusted.thinkingBudget,
	} satisfies AnthropicOptions);
};

function createClient(
	model: Model<"anthropic-messages">,
	apiKey: string,
	optionsHeaders?: Record<string, string>,
): Anthropic {
	const betaFeatures: string[] = [];
	const needsInterleavedBeta = false;
	if (needsInterleavedBeta) {
		betaFeatures.push("interleaved-thinking-2025-05-14");
	}
	if (betaFeatures.length > 0) {
		betaFeatures.push("fine-grained-tool-streaming-2025-05-14");
	}

	return new Anthropic({
		apiKey,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: mergeHeaders(
			{
				accept: "application/json",
				"anthropic-dangerous-direct-browser-access": "true",
				...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
			},
			model.headers,
			optionsHeaders,
		),
	});
}

function buildParams(
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const { cacheControl } = getCacheControl(model.baseUrl, options?.cacheRetention);
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(context.messages, model, cacheControl),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	if (context.systemPrompt) {
		params.system = [
			{
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
	}

	if (options?.temperature !== undefined && !options?.thinkingEnabled) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	if (model.reasoning) {
		if (options?.thinkingEnabled) {
			if (supportsAdaptiveThinking(model.id)) {
				params.thinking = { type: "adaptive" };
				if (options.effort) {
					params.output_config = { effort: options.effort };
				}
			} else {
				params.thinking = {
					type: "enabled",
					budget_tokens: options.thinkingBudgetTokens || 1024,
				};
			}
		} else if (options?.thinkingEnabled === false) {
			params.thinking = { type: "disabled" };
		}
	}

	if (options?.metadata) {
		const userId = options.metadata.user_id;
		if (typeof userId === "string") {
			params.metadata = { user_id: userId };
		}
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	return params;
}

function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function convertMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	cacheControl?: { type: "ephemeral"; ttl?: "1h" },
): MessageParam[] {
	const params: MessageParam[] = [];
	const transformedMessages = transformMessages(messages, model, normalizeToolCallId);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return { type: "text", text: sanitizeSurrogates(item.text) };
					} else {
						return {
							type: "image",
							source: {
								type: "base64",
								media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
								data: item.data,
							},
						};
					}
				});
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter((b) => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter((b) => {
					if (b.type === "text") {
						return b.text.trim().length > 0;
					}
					return true;
				});
				if (filteredBlocks.length === 0) continue;
				params.push({ role: "user", content: filteredBlocks });
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];
			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking") {
					if (block.redacted) {
						blocks.push({ type: "redacted_thinking", data: block.thinkingSignature! });
						continue;
					}
					if (block.thinking.trim().length === 0) continue;
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
					} else {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "toolCall") {
					blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.arguments ?? {} });
				}
			}
			if (blocks.length === 0) continue;
			params.push({ role: "assistant", content: blocks });
		} else if (msg.role === "toolResult") {
			const toolResults: ContentBlockParam[] = [];
			toolResults.push({
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: nextMsg.toolCallId,
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}
			i = j - 1;
			params.push({ role: "user", content: toolResults });
		}
	}

	if (cacheControl && params.length > 0) {
		const lastMessage = params[params.length - 1];
		if (lastMessage.role === "user") {
			if (Array.isArray(lastMessage.content)) {
				const lastBlock = lastMessage.content[lastMessage.content.length - 1];
				if (lastBlock && (lastBlock.type === "text" || lastBlock.type === "image" || lastBlock.type === "tool_result")) {
					(lastBlock as any).cache_control = cacheControl;
				}
			} else if (typeof lastMessage.content === "string") {
				lastMessage.content = [
					{ type: "text", text: lastMessage.content, cache_control: cacheControl },
				] as any;
			}
		}
	}

	return params;
}

function convertTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	if (!tools) return [];
	return tools.map((tool) => {
		const jsonSchema = tool.parameters as any;
		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object" as const,
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

function mapStopReason(reason: Anthropic.Messages.StopReason | string): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		case "pause_turn":
			return "stop";
		case "stop_sequence":
			return "stop";
		case "sensitive":
			return "error";
		default:
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/ai/providers/anthropic.ts
git commit -m "feat(ai): add simplified anthropic provider for minimax"
```

---

### Task 9: 创建 Provider 注册和顶层流式 API

**Files:**
- Create: `src/core/ai/providers/register-builtins.ts`
- Create: `src/core/ai/stream.ts`
- Create: `src/core/ai/index.ts`

- [ ] **Step 1: 创建 `src/core/ai/providers/register-builtins.ts`**

```typescript
import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { AnthropicOptions } from "./anthropic.js";

interface LazyProviderModule<
	TApi extends Api,
	TOptions extends StreamOptions,
	TSimpleOptions extends SimpleStreamOptions,
> {
	stream: (model: Model<TApi>, context: Context, options?: TOptions) => AsyncIterable<AssistantMessageEvent>;
	streamSimple: (model: Model<TApi>, context: Context, options?: TSimpleOptions) => AsyncIterable<AssistantMessageEvent>;
}

interface AnthropicProviderModule {
	streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions>;
	streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions>;
}

let anthropicProviderModulePromise:
	| Promise<LazyProviderModule<"anthropic-messages", AnthropicOptions, SimpleStreamOptions>>
	| undefined;

function forwardStream(target: AssistantMessageEventStream, source: AsyncIterable<AssistantMessageEvent>): void {
	(async () => {
		for await (const event of source) {
			target.push(event);
		}
		target.end();
	})();
}

function createLazyLoadErrorMessage<TApi extends Api>(model: Model<TApi>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function createLazyStream<TApi extends Api, TOptions extends StreamOptions, TSimpleOptions extends SimpleStreamOptions>(
	loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>,
): StreamFunction<TApi, TOptions> {
	return (model, context, options) => {
		const outer = new AssistantMessageEventStream();
		loadModule()
			.then((module) => {
				const inner = module.stream(model, context, options);
				forwardStream(outer, inner);
			})
			.catch((error) => {
				const message = createLazyLoadErrorMessage(model, error);
				outer.push({ type: "error", reason: "error", error: message });
				outer.end(message);
			});
		return outer;
	};
}

function createLazySimpleStream<
	TApi extends Api,
	TOptions extends StreamOptions,
	TSimpleOptions extends SimpleStreamOptions,
>(loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>): StreamFunction<TApi, TSimpleOptions> {
	return (model, context, options) => {
		const outer = new AssistantMessageEventStream();
		loadModule()
			.then((module) => {
				const inner = module.streamSimple(model, context, options);
				forwardStream(outer, inner);
			})
			.catch((error) => {
				const message = createLazyLoadErrorMessage(model, error);
				outer.push({ type: "error", reason: "error", error: message });
				outer.end(message);
			});
		return outer;
	};
}

function loadAnthropicProviderModule(): Promise<
	LazyProviderModule<"anthropic-messages", AnthropicOptions, SimpleStreamOptions>
> {
	anthropicProviderModulePromise ||= import("./anthropic.js").then((module) => {
		const provider = module as AnthropicProviderModule;
		return {
			stream: provider.streamAnthropic,
			streamSimple: provider.streamSimpleAnthropic,
		};
	});
	return anthropicProviderModulePromise;
}

export const streamAnthropic = createLazyStream(loadAnthropicProviderModule);
export const streamSimpleAnthropic = createLazySimpleStream(loadAnthropicProviderModule);

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
```

- [ ] **Step 2: 创建 `src/core/ai/stream.ts`**

```typescript
import "./providers/register-builtins.js";

import { getApiProvider } from "./api-registry.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.js";

export { getEnvApiKey } from "./env-api-keys.js";

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	return provider.stream(model, context, options as StreamOptions);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	return provider.streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}
```

- [ ] **Step 3: 创建 `src/core/ai/index.ts`**

```typescript
export type { Static, TSchema } from "@sinclair/typebox";
export { Type } from "@sinclair/typebox";

export * from "./api-registry.js";
export * from "./env-api-keys.js";
export * from "./models.js";
export type { AnthropicOptions } from "./providers/anthropic.js";
export * from "./providers/register-builtins.js";
export * from "./stream.js";
export * from "./types.js";
export * from "./utils/event-stream.js";
export * from "./utils/json-parse.js";
export * from "./utils/overflow.js";
```

- [ ] **Step 4: Commit**

```bash
git add src/core/ai/providers/register-builtins.ts src/core/ai/stream.ts src/core/ai/index.ts
git commit -m "feat(ai): add provider registration and top-level streaming api"
```

---

### Task 10: 类型检查验证

**Files:**
- (无新文件)

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
bun run typecheck
```

Expected: `tsc --noEmit` 成功通过，无类型错误。

- [ ] **Step 2: 若出现错误则修复**

根据 `tsc` 输出，修改对应的 `.ts` 文件（通常是 import 路径或类型不匹配问题），直到命令通过。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(ai): typecheck passes for minimax ai layer"
```

---

## Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 安装 `@anthropic-ai/sdk`、`@sinclair/typebox`、`ajv`、`ajv-formats`、`partial-json` | Task 1 |
| 通用异步事件流 `AssistantMessageEventStream` | Task 2 |
| 统一类型定义（Message、Model、Context、AssistantMessageEvent 等） | Task 4 |
| 模型注册表（仅 minimax / minimax-cn） | Task 5 |
| API provider 注册表 | Task 6 |
| env-api-keys（仅 minimax） | Task 6 |
| 简化版 anthropic provider | Task 8 |
| provider 懒加载注册 | Task 9 |
| 顶层 `stream` / `streamSimple` / `complete` / `completeSimple` | Task 9 |
| 类型检查验证 | Task 10 |

## Placeholder 扫描

- 无 "TBD"、"TODO"、"implement later"
- 所有代码步骤均包含完整代码块
- 所有命令均包含预期输出

## 类型一致性检查

- `StreamFunction<TApi, TOptions>` 签名在 `types.ts`、`api-registry.ts`、`anthropic.ts`、`register-builtins.ts` 中一致
- `AssistantMessageEventStream` 在 `event-stream.ts` 中定义，并在 `types.ts` 中重新导出
- `AnthropicOptions` 在 `anthropic.ts` 中定义，在 `index.ts` 中类型导出
- `MODELS` 结构使用 `satisfies Model<"anthropic-messages">`，与 `getModel` 泛型签名兼容

---

**Plan complete and saved to `docs/superpowers/plans/2025-04-15-minimax-ai-layer.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
