# Agent Loop

## 概述

`runAgentLoop` 和 `runAgentLoopContinue` 是低级别的循环函数，绕过了 Agent 类的状态管理。

## runAgentLoop

启动新的 agent 对话：

```typescript
import { runAgentLoop, type AgentEventSink } from "../../src/agent/index.js";

const messages: AgentMessage[] = [];

const emit: AgentEventSink = async (event) => {
  console.log("Event:", event.type);
  messages.push(event as any);  // 保存事件用于调试
};

const result = await runAgentLoop(
  [{ role: "user", content: "Hello", timestamp: Date.now() }],
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

## runAgentLoopContinue

继续现有对话：

```typescript
// 假设已有对话历史
const existingContext = {
  systemPrompt: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "What is 2 + 2?", timestamp: Date.now() },
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

## AgentLoopConfig

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

## 何时使用 Low-Level Loop

- **需要更多控制**：直接管理消息历史
- **自定义状态管理**：不想用 Agent 类的内置状态
- **嵌入式使用**：将 agent 嵌入到现有系统

## 对比：Agent 类 vs Low-Level Loop

| 特性 | Agent 类 | Low-Level Loop |
|------|----------|----------------|
| 状态管理 | 内置 | 手动 |
| 消息队列 | 内置（steer/followUp） | 手动实现 |
| 事件订阅 | 内置 subscribe() | 手动 emit |
| 复杂度 | 简单 | 较高 |
| 灵活性 | 一般 | 高 |

## 完整示例

```typescript
import { runAgentLoop, runAgentLoopContinue, type AgentEventSink } from "../../src/agent/index.js";
import { getModel } from "../../src/core/ai/index.js";
import { Type } from "@sinclair/typebox";

// 定义工具
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

// 事件处理器
const emit: AgentEventSink = async (event) => {
  console.log(`[${event.type}]`);
};

// 运行
await runAgentLoop(
  [{ role: "user", content: "What is 5 + 3?", timestamp: Date.now() }],
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
