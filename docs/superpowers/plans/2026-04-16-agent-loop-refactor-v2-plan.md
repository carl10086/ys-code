# agent-loop.ts 补完重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 补完 `agent-loop.ts` 的编排层职责，消除 `firstTurn` 标志和死代码，提取 `runTurnOnce`，补充中文注释。外部 API 和事件序列零变化。

**架构：** 将 `runLoop` 的内层循环体提取为独立的 `runTurnOnce` 函数；`runLoop` 降为纯 turn 序列编排器；入口函数预发射首次 `turn_start`。

**技术栈：** TypeScript、Bun test、纯中文 JSDoc

---

## Task 1: 确认测试基线（绿）

**文件：** `src/agent/__tests__/agent-loop.test.ts`、`stream-assistant.test.ts`、`tool-execution.test.ts`

- [ ] **Step 1: 运行全部测试确认通过**

```bash
bun run test src/agent/__tests__/
```

Expected: `19 pass, 0 fail`

- [ ] **Step 2: 提交基线**

```bash
git add -A
git commit -m "chore: 确认 agent 测试基线"
```

---

## Task 2: 删除 `createAgentStream` 死代码

**文件：** `src/agent/agent-loop.ts`

- [ ] **Step 1: 删除死代码并更新 import**

从 `src/agent/agent-loop.ts` 中删除以下代码：

```typescript
function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );
}
```

同时删除顶部 import 中不再使用的 `EventStream` 和 `type ToolResultMessage`（如果其他地方也不需要的话）。

- [ ] **Step 2: 确认 TypeScript 类型检查**

```bash
bun run typecheck 2>&1 | grep -E "error|agent-loop"
```

Expected: 无 agent-loop.ts 相关错误

- [ ] **Step 3: 运行测试确认无回归**

```bash
bun run test src/agent/__tests__/
```

Expected: `19 pass`

- [ ] **Step 4: 提交**

```bash
git add src/agent/agent-loop.ts
git commit -m "refactor(agent): 删除从未使用的 createAgentStream"
```

---

## Task 3: 提取 `runTurnOnce` 函数

**文件：** `src/agent/agent-loop.ts`

- [ ] **Step 1: 在 `runLoop` 之前添加 `runTurnOnce` 函数**

将以下代码插入到 `runLoop` 函数定义之前：

```typescript
/**
 * 执行单次完整的 turn：注入 pending messages → 请求 assistant 响应 → 执行 tools → 发射 turn_end
 * @param currentContext 当前 agent 上下文（会被直接修改）
 * @param newMessages 累积的新消息列表（会被直接修改）
 * @param pendingMessages 待注入的消息队列（如 steering / follow-up）
 * @returns assistantMessage 助手回复消息，toolResults 工具执行结果列表
 */
async function runTurnOnce(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  pendingMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<{ assistantMessage: AssistantMessage; toolResults: ToolResultMessage[] }> {
  // --- 注入 pending messages ---
  for (const message of pendingMessages) {
    await emit({ type: "message_start", message });
    await emit({ type: "message_end", message });
    currentContext.messages.push(message);
    newMessages.push(message);
  }

  // --- 请求 assistant 响应 ---
  const assistantMessage = await streamAssistantResponse(
    currentContext,
    config,
    signal,
    emit,
    streamFn,
  );
  newMessages.push(assistantMessage);

  // --- 执行 tools ---
  const toolResults: ToolResultMessage[] = [];
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
  if (toolCalls.length > 0) {
    toolResults.push(...(await executeToolCalls(currentContext, assistantMessage, config, signal, emit)));
    for (const result of toolResults) {
      currentContext.messages.push(result);
      newMessages.push(result);
    }
  }

  // --- 发射 turn_end ---
  await emit({ type: "turn_end", message: assistantMessage, toolResults });

  return { assistantMessage, toolResults };
}
```

需要补充 `ToolResultMessage` 和 `AssistantMessage` 的 import：

```typescript
import { type ToolResultMessage } from "../core/ai/index.js";
```

在文件顶部的 import 中已存在。

- [ ] **Step 2: 修改 `runLoop`，调用 `runTurnOnce`**

将 `runLoop` 替换为以下代码：

```typescript
/**
 * turn 序列编排器：循环调用 runTurnOnce，处理 steering/follow-up，控制 agent 生命周期
 */
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let hasPreEmittedTurnStart = true; // 入口已预先发射首次 turn_start

  while (true) {
    let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];
    let hasMoreToolCalls = true;

    // --- turn 内链式调用阶段 ---
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!hasPreEmittedTurnStart) {
        await emit({ type: "turn_start" });
      }
      hasPreEmittedTurnStart = false;

      const { assistantMessage, toolResults } = await runTurnOnce(
        currentContext,
        newMessages,
        pendingMessages,
        config,
        signal,
        emit,
        streamFn,
      );

      // --- 异常终止检查 ---
      if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      // --- 判断是否继续本轮链式调用 ---
      const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
      hasMoreToolCalls = toolCalls.length > 0;
      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // --- turn 间 follow-up 阶段 ---
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      hasPreEmittedTurnStart = false; // follow-up 开启新 turn，需要发射 turn_start
      continue;
    }

    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}
```

- [ ] **Step 3: 运行测试确认无回归**

```bash
bun run test src/agent/__tests__/
```

Expected: `19 pass`

- [ ] **Step 4: 提交**

```bash
git add src/agent/agent-loop.ts
git commit -m "refactor(agent): 提取 runTurnOnce，消除 firstTurn"
```

---

## Task 4: 补充中文注释（JSDoc + 节点分隔注释）

**文件：** `src/agent/agent-loop.ts`

- [ ] **Step 1: 为入口函数补充 JSDoc**

在 `runAgentLoop` 顶部添加：

```typescript
/**
 * 启动一个完整的 agent 会话
 * @param prompts 初始用户消息列表
 * @param context agent 初始上下文（会被拷贝）
 * @param config agent 循环配置
 * @param emit 事件发射器
 * @param signal 中断信号
 * @param streamFn 自定义流函数（可选）
 * @returns 包含所有新消息的完整列表
 */
```

在 `runAgentLoopContinue` 顶部添加：

```typescript
/**
 * 从已有上下文继续生成新消息（用于流式场景下的 resume）
 * @param context agent 上下文（最后一条消息必须为 user 或 toolResult）
 * @param config agent 循环配置
 * @param emit 事件发射器
 * @param signal 中断信号
 * @param streamFn 自定义流函数（可选）
 * @returns 新生成的 assistant 消息列表
 */
```

- [ ] **Step 2: 运行测试确认无回归**

```bash
bun run test src/agent/__tests__/
```

Expected: `19 pass`

- [ ] **Step 3: 提交**

```bash
git add src/agent/agent-loop.ts
git commit -m "docs(agent): 补充 agent-loop.ts 全中文 JSDoc 注释"
```

---

## Task 5: 最终验证

- [ ] **Step 1: 运行全部测试**

```bash
bun run test src/agent/__tests__/
```

Expected: `19 pass, 0 fail`

- [ ] **Step 2: TypeScript 类型检查**

```bash
bun run typecheck 2>&1 | grep -E "error" | head -20
```

Expected: 无错误输出

- [ ] **Step 3: 确认导出未变**

```bash
grep -n "export" src/agent/agent-loop.ts
```

Expected: 只有 `runAgentLoop` 和 `runAgentLoopContinue` 被导出

- [ ] **Step 4: 提交最终版本**

```bash
git add src/agent/agent-loop.ts
git commit -m "refactor(agent): 完成 agent-loop.ts 补完重构

- 提取 runTurnOnce，职责单一
- 消除 firstTurn，改用 hasPreEmittedTurnStart
- 删除死代码 createAgentStream
- 补充全中文 JSDoc 注释
- 19 个测试全部通过"
```
