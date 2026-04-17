# docs/usage/agent 文档更新实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 基于 `src/agent/` 的新三模块架构，重写 `loop.md`、新建 `architecture.md`、更新 `README.md`，使文档同时服务用户和贡献者。

**架构：** 用户指南与开发者解析分离；`loop.md` 保留入口位置但内容双层化；`architecture.md` 承担架构教学职责。

**技术栈：** Markdown、TypeScript 示例代码

---

## Task 1: 备份现有文档

**文件：**
- 读取：`docs/usage/agent/loop.md`
- 读取：`docs/usage/agent/README.md`

- [ ] **Step 1: 确认文件存在**

```bash
ls -la docs/usage/agent/loop.md docs/usage/agent/README.md
```

Expected: 两个文件均存在

- [ ] **Step 2: 备份到临时目录（可选）**

```bash
cp docs/usage/agent/loop.md /tmp/loop.md.bak
```

---

## Task 2: 重写 `loop.md`

**文件：**
- 修改：`docs/usage/agent/loop.md`

- [ ] **Step 1: 用以下完整内容覆盖 `loop.md`**

```markdown
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
```

- [ ] **Step 2: 运行简单校验**

```bash
head -5 docs/usage/agent/loop.md && echo "---" && wc -l docs/usage/agent/loop.md
```

Expected: 第一行为 `# Agent Loop`，总行数约 180-200

- [ ] **Step 3: 提交**

```bash
git add docs/usage/agent/loop.md
git commit -m "docs(agent): 重写 loop.md，拆分用户指南与开发者深度解析"
```

---

## Task 3: 新建 `architecture.md`

**文件：**
- 创建：`docs/usage/agent/architecture.md`

- [ ] **Step 1: 创建文件并写入完整内容**

```markdown
# Agent 架构

本文档面向希望理解 `src/agent/` 内部结构的贡献者，说明三个核心模块的职责边界、数据流和事件发射规则。

## 模块职责

| 模块文件 | 核心职责 | 关键导出 |
|---------|---------|---------|
| `agent-loop.ts` | 编排层。负责 turn 序列调度、steering/follow-up 处理、事件生命周期控制 | `runAgentLoop`, `runAgentLoopContinue` |
| `stream-assistant.ts` | 流式响应层。负责与 LLM 建立流式连接、处理 delta 事件、finalize 消息 | `streamAssistantResponse`, `AgentEventSink` |
| `tool-execution.ts` | 工具执行层。负责工具查找、参数校验、顺序/并行执行、before/after 钩子 | `executeToolCalls` |

## 数据流时序

一次包含 tool 调用的完整 turn 的数据流如下：

1. `runLoop` 调用 `runTurnOnce`
2. `runTurnOnce` 注入 pending messages（steering 或 follow-up），发射 `message_start` / `message_end`
3. `runTurnOnce` 调用 `streamAssistantResponse`
4. `streamAssistantResponse` 建立与 LLM 的流式连接，内部可能发射：
   - `message_start`（流开始）
   - `message_update`（多次，text/thinking/toolcall delta）
   - `message_end`（流结束）
5. 如果 assistant 消息包含 `toolCall`，`runTurnOnce` 调用 `executeToolCalls`
6. `executeToolCalls` 根据 `toolExecution` 配置决定顺序或并行执行：
   - 发射 `tool_execution_start`
   - 可选发射 `tool_execution_update`（工具执行过程中的部分结果）
   - 发射 `tool_execution_end`
7. `runTurnOnce` 发射 `turn_end`，携带 assistant 消息和 tool 结果
8. `runLoop` 判断是否有 steering 消息或更多 tool calls，决定是否继续下一轮

## 事件矩阵

| 事件 | 发射模块 | 触发时机 |
|------|---------|---------|
| `agent_start` | `agent-loop.ts`（入口函数） | 会话开始时 |
| `turn_start` | `agent-loop.ts`（入口函数 / `runLoop`） | 每个 turn 开始时 |
| `message_start` / `message_end` | `agent-loop.ts` / `stream-assistant.ts` | 消息注入或流式响应开始/结束时 |
| `message_update` | `stream-assistant.ts` | 流式 delta 到达时 |
| `tool_execution_start` / `update` / `end` | `tool-execution.ts` | 工具调用各阶段 |
| `turn_end` | `agent-loop.ts`（`runTurnOnce`） | turn 结束时 |
| `agent_end` | `agent-loop.ts`（`runLoop`） | 会话结束时 |

> 事件类型的完整字段定义请参考 [events.md](./events.md)。

## 状态修改边界

以下位置会修改 `AgentContext.messages`：

- **`agent-loop.ts`（入口函数）**：初始化时拷贝原上下文并注入 prompts
- **`agent-loop.ts`（`runTurnOnce`）**：注入 steering/follow-up 消息和 tool results
- **`stream-assistant.ts`**：追加或替换 assistant 消息（流式响应的 partial → final 过程）

## 控制流说明

### 为什么没有 firstTurn 标志？

在旧实现中，`runLoop` 内部使用 `firstTurn` 布尔变量来控制首次 `turn_start` 的发射。这导致入口初始化逻辑和循环控制耦合。

当前实现改为：
- `runAgentLoop` 和 `runAgentLoopContinue` 在调用 `runLoop` **之前**预先发射一次 `turn_start`
- `runLoop` 内部使用 `hasPreEmittedTurnStart`（初始 `true`）记录"首次已发射"
- 后续 turn 在调用 `runTurnOnce` 之前统一发射 `turn_start`

这样，`runLoop` 的职责单一化：只负责 turn 序列编排，不关心入口初始化的特殊性。

### runTurnOnce 的职责边界

`runTurnOnce` 只做一件事：**完成一次完整的 turn**。它不知道自己是第几次被调用，也不处理 follow-up 或 agent 生命周期。这些决策都交给调用方 `runLoop`。

```
runTurnOnce 的输入：currentContext, newMessages, pendingMessages, config, signal, emit, streamFn
runTurnOnce 的输出：{ assistantMessage, toolResults }
```

## 源码导航

- 事件类型定义：`src/agent/types.ts`
- 主循环入口：`src/agent/agent-loop.ts`
- 流式响应：`src/agent/stream-assistant.ts`
- 工具执行：`src/agent/tool-execution.ts`
- 面向用户的 API：`src/agent/agent.ts`
```

- [ ] **Step 2: 确认文件创建成功**

```bash
ls -la docs/usage/agent/architecture.md && wc -l docs/usage/agent/architecture.md
```

Expected: 文件存在，约 90-100 行

- [ ] **Step 3: 提交**

```bash
git add docs/usage/agent/architecture.md
git commit -m "docs(agent): 新建 architecture.md，说明三模块职责与数据流"
```

---

## Task 4: 更新 `README.md`

**文件：**
- 修改：`docs/usage/agent/README.md`

- [ ] **Step 1: 在 README.md 的"下一步"列表中添加 architecture.md 链接**

找到 README.md 中的以下内容：

```markdown
## 下一步

- [API 参考](./api-reference.md) - Agent 类所有方法
- [事件](./events.md) - AgentEvent 事件类型
- [Tools](./tools.md) - 定义和使用工具
- [状态管理](./state.md) - state 属性详解
- [Loop](./loop.md) - 低级 runAgentLoop 函数
```

在 Loop 行之后插入一行：

```markdown
- [架构](./architecture.md) - 内部模块职责与数据流
```

- [ ] **Step 2: 确认修改**

```bash
grep -n "architecture.md" docs/usage/agent/README.md
```

Expected: 输出包含 `architecture.md`

- [ ] **Step 3: 提交**

```bash
git add docs/usage/agent/README.md
git commit -m "docs(agent): 在 README.md 中添加 architecture.md 链接"
```

---

## Task 5: 最终验证

- [ ] **Step 1: 检查所有链接是否可访问**

在 `docs/usage/agent/` 目录内检查相对链接的有效性：

```bash
cd docs/usage/agent && ls -la loop.md architecture.md README.md
```

Expected: 三个文件均存在

- [ ] **Step 2: 检查代码示例语法**

```bash
grep -A 20 "runAgentLoop" docs/usage/agent/loop.md | head -25
```

Expected: import 路径和调用签名与源码一致

- [ ] **Step 3: 确认纯中文规范**

```bash
grep -n "^//" docs/usage/agent/architecture.md | head -5
grep -n "^//" docs/usage/agent/loop.md | head -5
```

Expected: 正文和注释均为中文

- [ ] **Step 4: 提交最终版本**

```bash
git add docs/usage/agent/
git commit -m "docs(agent): 完成 agent 文档更新\n\n- 重写 loop.md：用户指南 + 开发者深度解析\n- 新建 architecture.md：模块职责、数据流、事件矩阵\n- 更新 README.md 链接\n- 所有新增内容使用纯中文"
```

