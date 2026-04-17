# Agent Loop

## 用户快速开始

### 概述

`runAgentLoop` 和 `runAgentLoopContinue` 是低级别的循环函数，绕过了 `Agent` 类的状态管理。当你需要完全控制消息历史、事件流或自定义状态持久化时，可以使用它们。

### runAgentLoop

启动新的 agent 对话：

```typescript
import { runAgentLoop, type AgentEventSink } from "../../src/agent/index.js";

const emit: AgentEventSink = async (event) => {
  console.log("Event:", event.type);
};

const result = await runAgentLoop(
  [{ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: Date.now() }],
  {
    systemPrompt: "You are a helpful assistant.",
    messages: [],
    tools: [/* your tools */],
  },
  {
    model: getModel("minimax-cn", "MiniMax-M2.7-highspeed"),
    reasoning: "off",
    convertToLlm: (msgs) => msgs.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),
    getApiKey: () => process.env.MINIMAX_API_KEY,
  },
  emit,
  signal,  // 可选 AbortSignal
  streamFn,  // 可选自定义流函数
);
```

### runAgentLoopContinue

继续现有对话：

```typescript
const existingContext = {
  systemPrompt: "You are a helpful assistant.",
  messages: [
    { role: "user", content: [{ type: "text", text: "What is 2 + 2?" }], timestamp: Date.now() },
    { role: "assistant", content: [{ type: "text", text: "4" }], timestamp: Date.now() },
  ],
  tools: [/* your tools */],
};

const result = await runAgentLoopContinue(
  existingContext,
  {
    model: getModel("minimax-cn", "MiniMax-M2.7-highspeed"),
    reasoning: "off",
    convertToLlm: (msgs) => msgs.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),
    getApiKey: () => process.env.MINIMAX_API_KEY,
  },
  emit,
  signal,
  streamFn,
);
```

### AgentLoopConfig 速查表

```typescript
interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => string | undefined;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode;
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}
```

### 何时使用 Low-Level Loop

- **需要更多控制**：直接管理消息历史
- **自定义状态管理**：不想用 Agent 类的内置状态
- **嵌入式使用**：将 agent 嵌入到现有系统

### 对比：Agent 类 vs Low-Level Loop

| 特性 | Agent 类 | Low-Level Loop |
|------|----------|----------------|
| 状态管理 | 内置 | 手动 |
| 消息队列 | 内置（steer/followUp） | 手动实现 |
| 事件订阅 | 内置 subscribe() | 手动 emit |
| 复杂度 | 简单 | 较高 |
| 灵活性 | 一般 | 高 |

### 完整示例

```typescript
import { runAgentLoop, type AgentEventSink } from "../../src/agent/index.js";
import { getModel } from "../../src/core/ai/index.js";
import { Type } from "@sinclair/typebox";

const addTool = {
  name: "add",
  description: "Add two numbers",
  parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
  label: "Add",
  async execute(id, params) {
    return {
      content: [{ type: "text", text: `${params.a} + ${params.b} = ${params.a + params.b}` }],
      details: { result: params.a + params.b },
    };
  },
};

const emit: AgentEventSink = async (event) => {
  console.log(`[${event.type}]`);
};

await runAgentLoop(
  [{ role: "user", content: [{ type: "text", text: "What is 5 + 3?" }], timestamp: Date.now() }],
  {
    systemPrompt: "You are a math assistant. Use tools for calculations.",
    messages: [],
    tools: [addTool],
  },
  {
    model: getModel("minimax-cn", "MiniMax-M2.7-highspeed"),
    reasoning: "off",
    convertToLlm: (msgs) => msgs.filter((m) =>
      ["user", "assistant", "toolResult"].includes(m.role)
    ),
    getApiKey: () => process.env.MINIMAX_API_KEY,
  },
  emit
);
```

---

## 开发者深度解析

### 生命周期事件时序

一次完整的 agent 会话会按以下顺序发射事件（缩进表示嵌套关系）：

```
agent_start
  turn_start
    message_start  (prompt 或 pending message)
    message_end
    message_start  (assistant 响应开始)
      message_update  (流式 delta，可能多次)
    message_end    (assistant 响应结束)
    tool_execution_start
      tool_execution_update  (可选，可能多次)
    tool_execution_end
    ... (更多 tool_execution_*，如果顺序执行)
  turn_end
  turn_start  (新 turn，如果有 follow-up 或 steering)
  ...
agent_end
```

关于每种事件类型的详细定义，请参考 [events.md](./events.md)。

### steering 与 follow-up 机制

#### steering

`getSteeringMessages` 在每次 turn 结束后被调用。如果返回非空数组，这些消息会被注入到**下一轮 turn** 的上下文中，用于动态调整 agent 行为。

#### follow-up

`getFollowUpMessages` 在 agent 即将停止时被调用。如果返回非空数组，这些消息会触发**新一轮外层 turn**，通常用于追问或补充上下文。

### 入口函数的职责边界

- **`runAgentLoop`**：初始化上下文（拷贝并合并 prompts）、发射 `agent_start` 和首次 `turn_start`、注入 prompts 的 `message_start/end`、最后进入 `runLoop`
- **`runAgentLoopContinue`**：校验上下文（最后一条消息不能是 assistant）、发射 `agent_start` 和首次 `turn_start`、然后进入 `runLoop`

### runLoop 控制流图解

`runLoop` 使用双层循环控制整个会话：

- **外层 `while (true)`**：管理 turn 周期，处理 follow-up 消息，决定何时结束会话
- **内层 `while (hasMoreToolCalls || pendingMessages.length > 0)`**：管理单次 turn 内部的链式调用，包括 steering 消息注入、assistant 响应、工具执行

`runLoop` 不直接处理流式响应细节，而是将单次 turn 的执行委托给 `runTurnOnce`。

### 源码导航

- `runAgentLoop` / `runAgentLoopContinue`：`src/agent/agent-loop.ts`
- `runLoop`：`src/agent/agent-loop.ts`
- `runTurnOnce`：`src/agent/agent-loop.ts`
- `streamAssistantResponse`：`src/agent/stream-assistant.ts`
- `executeToolCalls`：`src/agent/tool-execution.ts`

想了解模块之间的完整关系，请参考 [architecture.md](./architecture.md)。
