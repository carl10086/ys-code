# docs/usage/agent 文档更新设计文档

## 1. 目标与范围

基于 `src/agent/` 目录的新三模块架构（`agent-loop.ts`、`stream-assistant.ts`、`tool-execution.ts`），更新 `docs/usage/agent/` 下的文档，使其同时满足：

- **用户视角**：快速理解如何使用 `Agent` 类和低级别 `runAgentLoop`。
- **贡献者视角**：理解内部模块职责边界、数据流时序和事件发射规则。

### 成功标准

- `loop.md` 被拆分为「用户快速开始」和「开发者深度解析」两部分
- 新增 `architecture.md`，清晰说明三个模块的职责和数据流
- 所有新增/修改内容使用纯中文，技术术语保留原文
- 文档中的代码示例与当前源码保持一致
- 不破坏现有文档的相对链接结构

---

## 2. 文档结构

```
docs/usage/agent/
  README.md          # 不变，快速开始入口
  api-reference.md   # 不变，Agent 类 API
  events.md          # 不变，事件类型参考
  tools.md           # 不变，工具定义指南
  state.md           # 不变，状态管理说明
  loop.md            # 重写：用户指南 + 开发者深度解析
  architecture.md    # 新增：模块架构与数据流
```

---

## 3. `loop.md` 重写方案

### 3.1 用户指南部分（面向使用者）

保留并精简现有内容：

1. **概述**：`runAgentLoop` 和 `runAgentLoopContinue` 是什么、什么时候用
2. **`runAgentLoop` 快速开始**：最小可运行示例（保留现有代码块，更新 import 路径确保正确）
3. **`runAgentLoopContinue` 续跑示例**：从已有上下文继续
4. **`AgentLoopConfig` 速查表**：关键配置项的用途（`model`、`convertToLlm`、`toolExecution`、`beforeToolCall`、`afterToolCall`、`getSteeringMessages`、`getFollowUpMessages`）
5. **何时使用 Low-Level Loop**：与 Agent 类的对比表格（保留现有表格）
6. **完整示例**：带工具调用的完整代码示例

### 3.2 开发者深度解析部分（面向贡献者）

新增内容，解释内部机制：

1. **生命周期事件时序**：用代码注释风格的时序图说明 `agent_start` → `turn_start` → `message_start` → `message_update` → `message_end` → `tool_execution_start` → `tool_execution_update` → `tool_execution_end` → `turn_end` → `agent_end` 的完整顺序
2. **steering 与 follow-up 机制**：
   - `getSteeringMessages` 在 turn 之间注入消息
   - `getFollowUpMessages` 在 agent 即将结束时触发新一轮 turn
3. **入口函数的职责边界**：
   - `runAgentLoop`：初始化上下文、预发射首次 `turn_start`、注入 prompts
   - `runAgentLoopContinue`：校验上下文、预发射首次 `turn_start`、进入循环
4. **`runLoop` 控制流图解**：用文字说明 `while (true)` 外层循环（turn 周期）和内层循环（链式 tool 调用）的关系
5. **源码导航**：给出关键函数的源码位置（`src/agent/agent-loop.ts:runLoop`、`src/agent/agent-loop.ts:runTurnOnce`）

---

## 4. `architecture.md` 新建方案

### 4.1 模块职责表

| 模块文件 | 核心职责 | 关键导出 |
|---------|---------|---------|
| `agent-loop.ts` | 编排层。负责 turn 序列调度、steering/follow-up 处理、事件生命周期控制 | `runAgentLoop`, `runAgentLoopContinue` |
| `stream-assistant.ts` | 流式响应层。负责与 LLM 建立流式连接、处理 delta 事件、finalize 消息 | `streamAssistantResponse`, `AgentEventSink` |
| `tool-execution.ts` | 工具执行层。负责工具查找、参数校验、顺序/并行执行、before/after 钩子 | `executeToolCalls` |

### 4.2 数据流时序说明

用文字描述一次包含 tool 调用的完整 turn：

1. `runLoop` 调用 `runTurnOnce`
2. `runTurnOnce` 注入 pending messages（如有）
3. `runTurnOnce` 调用 `streamAssistantResponse`
4. `streamAssistantResponse` 内部可能发射 `message_start` → `message_update`（多次）→ `message_end`
5. 如果 assistant 消息包含 `toolCall`，`runTurnOnce` 调用 `executeToolCalls`
6. `executeToolCalls` 按顺序或并行执行工具，发射 `tool_execution_start` → `tool_execution_update`（可选）→ `tool_execution_end`
7. `runTurnOnce` 发射 `turn_end`
8. `runLoop` 判断是否继续下一轮

### 4.3 事件矩阵

说明每个事件是由哪个模块发射的：

| 事件 | 发射模块 | 触发时机 |
|------|---------|---------|
| `agent_start` | `agent-loop.ts`（入口函数） | 会话开始时 |
| `turn_start` | `agent-loop.ts`（入口函数 / `runLoop`） | 每个 turn 开始时 |
| `message_start` / `message_end` | `agent-loop.ts` / `stream-assistant.ts` | 消息注入或流式响应开始/结束时 |
| `message_update` | `stream-assistant.ts` | 流式 delta 到达时 |
| `tool_execution_start` / `update` / `end` | `tool-execution.ts` | 工具调用各阶段 |
| `turn_end` | `agent-loop.ts`（`runTurnOnce`） | turn 结束时 |
| `agent_end` | `agent-loop.ts`（`runLoop`） | 会话结束时 |

### 4.4 状态修改边界

说明哪些模块会修改 `AgentContext.messages`：

- `agent-loop.ts`（`runAgentLoop` / `runAgentLoopContinue`）：初始化时拷贝并注入 prompts
- `agent-loop.ts`（`runTurnOnce`）：注入 pending messages 和 tool results
- `stream-assistant.ts`：追加或替换 assistant 消息（流式响应过程中）

---

## 5. 内容规范

- 标题和正文使用简体中文
- 代码注释和文档说明使用纯中文
- 代码示例中的 import 路径必须与源码一致（`../../src/agent/index.js` 等）
- 时序图使用文本 Mermaid（如果渲染环境支持）或缩进代码块
- 避免重复 `events.md` 和 `api-reference.md` 中已有的内容，用链接引用

---

## 6. 验证计划

1. 检查 `loop.md` 中的代码示例是否可以直接复制运行（语法正确、import 路径有效）
2. 检查 `architecture.md` 中所有源码位置引用是否准确
3. 检查 `README.md` 到 `loop.md` 和 `architecture.md` 的链接是否需要更新
4. 用 markdown linter 检查格式一致性
