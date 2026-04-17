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
