# agent-loop.ts 可读性重构设计文档

## 1. 目标与范围

对 `src/agent/agent-loop.ts` 做一次中等规模的重构，**不改变任何外部 API 和事件语义**，仅通过拆分文件、提取函数、消除重复来提升可读性。注释统一为纯中文。

重构采用严格的测试驱动开发（TDD）：先为现有行为编写全面的单元测试，确保测试通过后再进行代码移动和提取；每一步重构后都立即运行测试验证。

### 成功标准

- `agent-loop.ts` 行数从 534 降到 150 以内
- `streamAssistantResponse` 和工具执行逻辑各自迁到独立文件
- 重复逻辑（`streamAssistantResponse` 末尾两次相同的 finalize 代码块）被消除
- `agent/index.ts` 的导出不变，外部调用方零感知
- 新增单元测试覆盖率全面，覆盖流式响应、顺序/并行工具执行、主循环控制流、事件发射时序、错误和取消场景
- 所有测试在重构前后均通过

---

## 2. 模块拆分

在 `src/agent/` 下新增两个文件，原文件大幅精简：

| 文件 | 职责 |
|------|------|
| `stream-assistant.ts` | `streamAssistantResponse` 及相关辅助类型/函数 |
| `tool-execution.ts` | `PreparedToolCall`、`ImmediateToolCallOutcome`、工具准备/执行/收尾的全部逻辑 |
| `agent-loop.ts` | `runLoop`、`runAgentLoop`、`runAgentLoopContinue` 入口，编排层 |

---

## 3. 每个模块的具体内容

### `stream-assistant.ts`

- 导出 `streamAssistantResponse`
- 内部新增 `finalizeStreamMessage` 辅助函数，统一处理 `response.result()` 后的消息替换/追加和事件发射，消除目前代码中第 96-121 行的重复块
- 保持现有事件发射顺序不变

### `tool-execution.ts`

- 移入以下类型：`PreparedToolCall`、`ImmediateToolCallOutcome`、`ExecutedToolCallOutcome`
- 移入以下函数：`createErrorToolResult`、`emitToolCallOutcome`、`prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall`、`executeToolCalls`、`executeToolCallsSequential`、`executeToolCallsParallel`
- 这些函数本身逻辑不变，只是换文件

### `agent-loop.ts`

- 保留 `createAgentStream`、`runLoop`、`runAgentLoop`、`runAgentLoopContinue`
- `runLoop` 内部允许做的小幅调整：把双重 `while` 的内层控制流梳理得更扁平。具体做法是保留外层 `while (true)`，内层通过 `hasMoreToolCalls || pendingMessages.length > 0` 驱动，但把 `firstTurn` 的处理和 `turn_start` 的发射逻辑收紧，减少嵌套层级
- 导入 `streamAssistantResponse` 和 `executeToolCalls`

---

## 4. 控制流微调说明

目前 `runLoop` 有两处可以安全简化：

### 4.1 `streamAssistantResponse` 末尾的重复 finalize

现在 `done/error` 分支（第 96-109 行）和 `for await` 结束后的 fallback（第 113-121 行）逻辑几乎一致。提取为 `finalizeStreamMessage` 后只调用一次。

### 4.2 `runLoop` 的 `firstTurn` 标志

目前通过 `firstTurn` 布尔值来决定是否发射 `turn_start`。微调后，在 `runAgentLoop` 和 `runAgentLoopContinue` 中先发射一次 `turn_start`，`runLoop` 内部每次循环开始时统一发射，从而去掉 `firstTurn` 变量。事件序列对外保持一致。

---

## 5. 注释规范

- 所有 JSDoc 和普通注释使用**纯中文**
- 关键控制节点用简短的分隔注释标出，例如 `// --- 工具执行阶段 ---`
- 不使用中英混注

---

## 6. TDD 与测试策略

### 6.1 测试前置

在修改 `agent-loop.ts` 之前，先为当前行为编写全面的单元测试。测试目标模块包括：

1. **`stream-assistant.test.ts`**
   - 正常流式响应：验证 `start`、`text_delta`、`toolcall_start`、`done` 等事件正确处理
   - 无流直接返回结果：验证 `for await` 零次迭代时的 finalize 路径
   - 错误场景：`streamFunction` 抛出异常时的处理
   - 取消场景：`signal` 触发 abort 时的行为
   - 事件时序：验证 `message_start`、`message_update`、`message_end` 的发射顺序和内容

2. **`tool-execution.test.ts`**
   - 顺序执行（`sequential`）：验证工具按顺序调用，结果顺序正确
   - 并行执行（`parallel`）：验证工具并发调用，结果顺序保持请求顺序
   - 工具不存在：验证返回错误结果
   - 参数校验失败：验证返回错误结果
   - `beforeToolCall` 拦截：验证 block 时返回错误，不 block 时正常执行
   - `afterToolCall` 覆盖：验证结果和错误状态可被修改
   - 工具执行异常：验证 `execute` 抛出时被捕获并转为错误结果
   - 更新事件：验证 `tool_execution_start`、`tool_execution_update`、`tool_execution_end` 的时序

3. **`agent-loop.test.ts`**
   - `runAgentLoop` 完整流程：从用户消息到 assistant 回复再到工具结果
   - `runAgentLoopContinue`：从已有上下文继续的流程
   - `turn_start` / `turn_end` / `agent_start` / `agent_end` 事件时序
   - `steeringMessages` 注入：验证在 turn 之间正确插入
   - `followUpMessages` 注入：验证在 agent 即将停止时插入并触发新一轮
   - 错误终止：`stopReason === "error"` 时正确结束并发射事件
   - 取消终止：`stopReason === "aborted"` 时正确结束并发射事件
   - 无工具调用时正常结束

### 6.2 重构中的测试守护

- 每完成一次代码移动或提取，立即运行全部测试
- 若测试失败，优先回滚或修复，不累积技术债务
- 重构完成后，确认所有新增测试和已有测试（如有）均通过

---

## 7. 验证计划

1. TypeScript 类型检查通过
2. 运行新增单元测试，全部通过
3. 快速 grep 确认 `agent-loop.ts` 的导出符号没有遗漏
4. 确认 `agent/index.ts` 无需修改
