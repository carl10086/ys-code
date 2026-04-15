# Agent 模块设计

## 概述

实现 ys-code 的核心 Agent 模块，作为调用层调用 `core/ai` 等底层能力。

## 目录结构

```
src/
  agent/                    # 核心 agent 组件
    types.ts                # 类型定义（扩展 core/ai/types）
    agent.ts                # Agent 类
    agent-loop.ts           # 核心循环逻辑
    index.ts                # 导出
  core/
    ai/                     # AI 能力（agent 依赖它）
```

## 类型设计

### 继承自 core/ai

- `Message`、`UserMessage`、`AssistantMessage`、`ToolResultMessage`
- `TextContent`、`ThinkingContent`、`ToolCall`、`ImageContent`
- `Model`、`Context`、`StreamOptions`、`SimpleStreamOptions`
- `Tool`（来自 `@sinclair/typebox` 的 `TSchema`）

### 新增类型

**AgentToolCall** - 从 AssistantMessage 提取的 toolCall 块
```typescript
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
```

**AgentMessage** - Agent 层消息，支持自定义扩展
```typescript
export interface CustomAgentMessages {}
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

**AgentTool** - 工具定义
```typescript
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

**AgentToolResult** - 工具执行结果
```typescript
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

**AgentContext** - 传给 loop 的上下文快照
```typescript
export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}
```

**AgentState** - 公开的 agent 状态
```typescript
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
```

**ThinkingLevel** - thinking 等级
```typescript
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

**AgentEvent** - 事件类型
```typescript
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

**AgentLoopConfig** - loop 配置
```typescript
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
```

**BeforeToolCallContext / AfterToolCallContext** - hooks 上下文
```typescript
export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  context: AgentContext;
}

export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult<any>;
  isError: boolean;
  context: AgentContext;
}
```

**BeforeToolCallResult / AfterToolCallResult** - hooks 返回值
```typescript
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
}
```

## Agent 类设计

### 构造选项

```typescript
export interface AgentOptions {
  initialState?: Partial<AgentState>;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  onPayload?: SimpleStreamOptions["onPayload"];
  beforeToolCall?: BeforeToolCallConfig;
  afterToolCall?: AfterToolCallConfig;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  sessionId?: string;
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;
}
```

### 公开 API

```typescript
class Agent {
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void;
  get state(): AgentState;
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
  clearSteeringQueue(): void;
  clearFollowUpQueue(): void;
  clearAllQueues(): void;
  hasQueuedMessages(): boolean;
  get signal(): AbortSignal | undefined;
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async continue(): Promise<void>;
}
```

### 内部机制

- 使用 `ActiveRun` 管理当前运行状态
- `PendingMessageQueue` 管理 steering/followUp 消息
- `MutableAgentState` 包装状态，支持 copy-on-write 数组
- 事件处理在 `processEvents()` 中集中进行

## AgentLoop 设计

### 核心函数

```typescript
// 启动新 prompt
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]>;

// 继续当前上下文
export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]>;
```

### 循环流程

```
while (hasToolCalls || pendingMessages) {
  1. 处理 pendingMessages（steering）
  2. 调用 streamAssistantResponse() 获取 LLM 响应
  3. 检查 stopReason（error/aborted 则结束）
  4. 执行工具调用
  5. emit turn_end
  6. 获取下一批 steering 消息
}
处理 followUp 消息（如果有）
emit agent_end
```

### 工具执行

支持 sequential 和 parallel 两种模式：

- **sequential**: 顺序执行每个工具调用
- **parallel**: 预检所有工具（prepare），然后并发执行允许的工具

工具执行流程：
1. `prepareToolCall` - 查找工具、验证参数、调用 beforeToolCall hook
2. `executePreparedToolCall` - 执行工具，捕获异常
3. `finalizeExecutedToolCall` - 调用 afterToolCall hook，生成 ToolResultMessage

## 与 core/ai 的集成

### 需要 core/ai 新增的导出

- `validateToolArguments` - 工具参数校验（基于 AJV + TypeBox schema）

### 依赖的 core/ai 现有导出

- `streamSimple` - 默认流函数
- `EventStream` - 事件流基类
- 类型：`Message`、`Context`、`Model`、`AssistantMessageEvent`、`Tool`、`ToolCall` 等

### 任务清单

1. **core/ai 新增**: `validateToolArguments` 函数（参考 pi-mono 实现）
2. **core/ai 更新**: `index.ts` 导出 `validateToolArguments`
3. **agent/types.ts**: 类型定义
4. **agent/agent-loop.ts**: 核心循环
5. **agent/agent.ts**: Agent 类
6. **agent/index.ts**: 导出

### 集成点

1. **流函数**: `Agent` 使用 `streamFn ?? streamSimple`
2. **消息转换**: `convertToLlm` 将 `AgentMessage[]` 转为 `Message[]`
3. **工具校验**: `validateToolArguments` 校验工具参数

## 文件清单

| 文件 | 功能 |
|------|------|
| `src/agent/index.ts` | 导出所有公开类型和类 |
| `src/agent/types.ts` | 所有类型定义 |
| `src/agent/agent.ts` | Agent 类实现 |
| `src/agent/agent-loop.ts` | 核心循环逻辑 |

## 实现顺序

1. `src/agent/types.ts` - 类型定义
2. `src/agent/agent-loop.ts` - 核心循环（不含 hooks）
3. `src/agent/agent.ts` - Agent 类
4. `src/agent/index.ts` - 导出
