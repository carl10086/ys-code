# examples 迁移到 AgentSession 设计

## 目标

将 `examples/agent-math.ts` 和 `examples/debug-agent-chat.ts` 从直接使用 `Agent` 迁移到 `AgentSession`，消除示例代码中的重复状态管理逻辑。

## 架构

### agent-math.ts

- 用 `AgentSession` 替换 `Agent`
- 订阅 `AgentSessionEvent`（`turn_start`、`thinking_delta`、`answer_delta`、`tool_start`、`tool_end`、`turn_end`）
- 删除对 `agent_start`、`agent_end`、`message_start`、`message_end` 的冗余处理
- 工具仍由示例自身定义并传入 `AgentSession`

### debug-agent-chat.ts

- 用 `AgentSession` 替换 `Agent + TurnFormatter`
- 直接复用 `src/cli/format.ts` 中的格式化函数（与 `src/cli/chat.ts` 保持一致）
- 删除 `TurnFormatter` 类及其维护的所有 turn 级状态（`hasEmittedThinking`、`toolStartTimes`、`turnStartTime` 等）
- `AgentSession` 负责的事件转换直接映射为格式化输出

### 不变

- `examples/chat-minimax-thinking.ts` 使用 `streamSimple`，不涉及 `Agent`，保持不动

## 测试验证

- 运行 `bun run examples/agent-math.ts` 验证输出正常
- 运行 `bun run examples/debug-agent-chat.ts` 验证输出格式与迁移前一致
