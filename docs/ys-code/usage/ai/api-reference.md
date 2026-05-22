# AI 模块 API 参考

## 导出列表

```typescript
// models.ts
export { getModel, getModels, getProviders, calculateCost } from "./models.js"

// stream.ts
export { stream, complete, streamSimple, completeSimple } from "./stream.js"

// env-api-keys.ts
export { getEnvApiKey } from "./env-api-keys.js"

// types.ts
export type { Model, Context, Message, UserMessage, AssistantMessage, ToolResultMessage, ToolCall, ... } from "./types.js"

// providers/register-builtins.ts
export { streamAnthropic, streamSimpleAnthropic, registerBuiltInApiProviders } from "./providers/register-builtins.js"
```

## 模型操作

### getModel

```typescript
function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(
  provider: TProvider,
  modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>>
```

根据 provider 和 modelId 获取模型实例。

```typescript
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
// model: Model<"anthropic-messages">
```

### getProviders

```typescript
function getProviders(): KnownProvider[]
```

获取所有可用 provider 列表。

```typescript
getProviders(); // ["minimax", "minimax-cn"]
```

### getModels

```typescript
function getModels<TProvider extends KnownProvider>(
  provider: TProvider,
): Model<...>[]
```

获取指定 provider 下所有模型。

```typescript
getModels("minimax-cn");
// [Model<"anthropic-messages">, Model<"anthropic-messages">]
```

### calculateCost

```typescript
function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"]
```

根据模型定价和实际用量计算费用。

```typescript
const cost = calculateCost(model, usage);
// cost: { input: 0.0003, output: 0.0012, cacheRead: ..., cacheWrite: ..., total: ... }
```

## 流式调用

### streamSimple

```typescript
function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream
```

最常用的流式调用入口。自动处理 reasoning 逻辑。

**SimpleStreamOptions：**

```typescript
interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;           // "minimal" | "low" | "medium" | "high" | "xhigh"
  thinkingBudgets?: ThinkingBudgets;    // 自定义 thinking token 预算
}
```

### stream

```typescript
function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): AssistantMessageEventStream
```

底层流式调用，不处理 reasoning。

### completeSimple

```typescript
async function completeSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage>
```

等待完整响应，返回 `AssistantMessage`。

### complete

```typescript
async function complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): Promise<AssistantMessage>
```

底层完整调用。

## Context 构建

```typescript
interface Context {
  systemPrompt?: string;           // 系统提示词
  messages: Message[];             // 消息列表
  tools?: Tool[];                  // 工具列表
}
```

### Message 类型

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

### UserMessage

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}
```

### AssistantMessage

```typescript
interface AssistantMessage {
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
```

### ToolResultMessage

```typescript
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: any;
  isError: boolean;
  timestamp: number;
}
```

## 事件流

### AssistantMessageEvent 类型

```typescript
type AssistantMessageEvent =
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
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

### AssistantMessageEventStream 方法

```typescript
class AssistantMessageEventStream implements AsyncIterable<AssistantMessageEvent> {
  push(event: AssistantMessageEvent): void;    // 推入事件
  end(final?: AssistantMessage): void;          // 标记结束
  result(): Promise<AssistantMessage>;          // 获取最终结果
  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
}
```

## StreamOptions

```typescript
interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  transport?: "sse" | "websocket" | "auto";
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<...>;
  headers?: Record<string, string>;
  maxRetryDelayMs?: number;
  metadata?: Record<string, unknown>;
}
```
