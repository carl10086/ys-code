# src/agent/types.ts 代码理解笔记

## 整体认知

`src/agent/types.ts` 是 Agent 层的**类型契约中心**。它本身不运行任何逻辑，但定义了 Agent 系统里所有角色怎么沟通、怎么传数据、怎么互相配合。

### 系统位置

```
上游依赖：src/core/ai（底层的 AI 流式调用、消息模型）
自身职责：定义 Agent 系统的数据结构契约
下游消费：Agent 的各个实现模块（AgentLoop、工具执行器、状态管理等）
```

### 核心价值

这个文件承担了一个**架构边界**的作用：把底层 AI 能力和上层 Agent 逻辑隔离开，让两边可以基于同一套稳定的接口各自演化。

---

## 知识点拆分

### 1. 核心数据类型

#### AgentMessage —— 消息类型

```typescript
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

- `Message` 来自 `core/ai`，是标准的 AI 消息（用户消息、助手消息、工具结果消息等）
- `CustomAgentMessages` 是一个空接口，专门留给业务通过 **declaration merging** 扩展自定义消息类型

#### AgentContext —— 上下文快照

```typescript
export interface AgentContext {
  systemPrompt: string;     // 系统提示词
  messages: AgentMessage[]; // 当前消息历史
  tools?: AgentTool<any>[]; // 可用的工具列表
}
```

这是 Agent 某一时刻的"快照"，记录了这个时刻 Agent 知道什么、手头有什么工具。

#### AgentState —— 公开状态

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

比 `AgentContext` 更丰富，是**对外暴露的运行时状态**。UI 层通常会监听/订阅这个状态，用来显示"AI 正在思考"、工具调用进度、错误提示等。`readonly` 字段表示外部只能观察，不能直接修改。

**关键区分**：`AgentContext` 是某一时刻的快照，`AgentState` 是持续 observable 的公开状态。

---

### 2. 工具系统

#### AgentTool —— 工具定义

```typescript
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
```

- `parameters` 使用 `@sinclair/typebox` 的 `TSchema`，支持运行时参数校验
- `prepareArguments` 是可选的预处理钩子，用于清洗 AI 传来的原始参数
- `execute` 支持 `AbortSignal`（中断）和 `onUpdate`（流式返回部分结果）

#### AgentToolResult —— 工具执行结果

```typescript
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

- `content`：给 AI/用户看的内容（文字或图片）
- `details`：额外的结构化数据，比如 HTTP 状态码、原始 JSON 等

#### 拦截器：beforeToolCall / afterToolCall

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

- `beforeToolCall`：工具执行前调用，可**阻止执行**
- `afterToolCall`：工具执行后调用，可**覆盖结果**

被阻止时，通常应向 AI 返回带有 `reason` 的结果，而不是简单标记为失败。

#### ToolExecutionMode —— 执行模式

```typescript
export type ToolExecutionMode = "sequential" | "parallel";
```

AI 一次可能要求调用多个工具。`sequential` 串行执行，`parallel` 并发执行。

---

### 3. 事件系统

`AgentEvent` 是 Agent 运行过程的统一广播格式，让外部可以观察到各个关键节点。

#### 生命周期事件
- `agent_start` / `agent_end`：整个 Agent 会话开始/结束
- `turn_start` / `turn_end`：一次"回合"开始/结束（AI 生成消息 + 可能执行工具）

#### 消息事件
- `message_start` / `message_end`：一条消息开始/结束生成
- `message_update`：消息在流式更新（实现打字机效果的核心事件）

#### 工具事件
- `tool_execution_start`：开始执行某个工具
- `tool_execution_update`：工具执行中流式返回部分结果
- `tool_execution_end`：工具执行结束

事件命名采用统一的 `_start`、`_update`、`_end` 三段式结构，方便 UI 层实现"从无到有、从少到多、再到最终定格"的状态更新。

---

### 4. 配置系统

#### AgentLoopConfig —— Agent 主循环配置

```typescript
export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode;
  beforeToolCall?: (...)
  afterToolCall?: (...)
}
```

关键字段说明：

| 字段 | 作用 |
|------|------|
| `convertToLlm` | 把 `AgentMessage[]` 转成底层 AI 能理解的 `Message[]` |
| `transformContext` | 发给模型前对消息历史做加工（如截断、压缩、RAG 注入） |
| `getSteeringMessages` | 动态获取引导性消息（具体插入时机需看实现） |
| `getFollowUpMessages` | 动态获取追加消息（具体插入时机需看实现） |
| `toolExecution` / `beforeToolCall` / `afterToolCall` | 执行模式和拦截器配置 |

**设计特点**：大量行为通过"函数注入"实现，让 `AgentLoop` 本身变得非常通用和薄。优点是灵活性高，缺点是调用方需要了解较多细节。

---

## 关键设计洞察

1. **类型作为架构边界**：这个文件把底层 `core/ai` 和上层 Agent 逻辑完全隔离，降低耦合。
2. **declaration merging 预留扩展**：`CustomAgentMessages` 空接口给业务保留了自定义消息类型的可能性。
3. **三段式事件设计**：`_start`、`_update`、`_end` 的统一命名模式，天然适合 UI 的状态驱动渲染。
4. **函数注入式配置**：`AgentLoopConfig` 不自己实现业务逻辑，而是通过注入函数把控制权交给调用方。
