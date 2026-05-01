# Implementation Plan: 删除 agent-loop 增量 newMessages

## Overview

本计划基于 `docs/ys-powers/specs/2026-04-29-remove-agent-loop-new-messages-design.md`，目标是删除 `src/agent/agent-loop.ts` 中用于收集本轮增量消息的 `newMessages` 设计，同时保留 tool result 的 `newMessages` 注入机制。实施重点是收窄 `AgentEvent.agent_end` 契约、简化 agent loop 参数传递、更新调用点和测试断言。

## Architecture Decisions

- 删除的是 agent-loop 级别的 `newMessages`，不是 tool result 的 `newMessages`。后者仍用于 `SkillTool` 将 `isMeta` skill prompt 注入下一轮模型上下文。
- `message_start` / `message_end` 继续作为 `Agent._state.messages` 的写入通道，`agent_end` 只表示生命周期结束，不携带消息 payload。
- `runAgentLoop()` 和 `runAgentLoopContinue()` 改为 `Promise<void>`，调用方不再从返回值读取增量消息。
- 本次不重命名 tool result `newMessages`，也不处理 `contextModifier`，避免扩大范围。

## Dependency Graph

```text
src/agent/types.ts
  AgentEvent.agent_end 契约
    ↓
src/agent/agent-loop.ts
  runLoop / runTurnOnce / runAgentLoop / runAgentLoopContinue
    ↓
src/agent/agent.ts
  runAgentLoop 调用点 + handleRunFailure 构造 agent_end
    ↓
src/agent/agent-loop.test.ts
src/agent/session.test.ts
  更新旧返回值和旧 agent_end payload 断言

独立但必须回归保护：
src/agent/tool-execution.ts
src/agent/tools/skill.ts
src/agent/tool-execution.test.ts
src/agent/tools/skill.test.ts
  tool result newMessages → currentContext.pendingMessages → 下一轮注入
```

## Task List

### Phase 1: 收窄事件契约

## Task 1: 移除 `AgentEvent.agent_end.messages` ✅

**Description:** 将 `src/agent/types.ts` 中的 `AgentEvent` 契约从 `{ type: "agent_end"; messages: AgentMessage[] }` 收窄为 `{ type: "agent_end" }`。这是后续删除 agent-loop 增量收集器的基础，因为旧 payload 是 `newMessages` 的主要出口之一。

**Acceptance criteria:**

- [x] `AgentEvent` 中 `agent_end` 不再包含 `messages` 字段。
- [x] 注释不再暗示 `agent_end` 携带本轮消息。
- [x] tool result `newMessages` 类型保持不变。

**Verification:**

- [x] 运行 `bun run typecheck`，确认所有旧 `agent_end.messages` 调用点暴露出来。（当前被无关 `src/agent/tools/webfetch.ts` 缺少 `turndown` 类型阻断。）

**Dependencies:** None

**Files likely touched:**

- `src/agent/types.ts`

**Estimated scope:** XS

### Checkpoint: 事件契约

- [x] `AgentEvent.agent_end` 类型已收窄。
- [x] 编译错误只来自需要更新的调用点和测试。

### Phase 2: 删除 agent-loop 增量收集器

## Task 2: 简化 `runTurnOnce()` 和 `runLoop()` ✅

**Description:** 从 `runTurnOnce()` 和 `runLoop()` 参数中移除 agent-loop 级别的 `newMessages`，删除 `newMessages.push(...)`，并将 `emit({ type: "agent_end", messages: newMessages })` 改为 `emit({ type: "agent_end" })`。

**Acceptance criteria:**

- [x] `runTurnOnce()` 不再接收 `newMessages` 参数。
- [x] `runLoop()` 不再接收 `newMessages` 参数。
- [x] `src/agent/agent-loop.ts` 中不再存在 agent-loop 增量用途的 `newMessages.push(...)`。
- [x] pending message 仍通过 `message_start` / `message_end` 事件发射，并继续追加到 `currentContext.messages`。
- [x] tool result 仍追加到 `currentContext.messages`。

**Verification:**

- [x] 运行 `bun run typecheck`，确认函数签名调用点已同步。（当前被无关 `src/agent/tools/webfetch.ts` 缺少 `turndown` 类型阻断。）
- [x] 人工检查 `currentContext.pendingMessages` 分支仍会触发下一轮 `pendingMessages` 注入。

**Dependencies:** Task 1

**Files likely touched:**

- `src/agent/agent-loop.ts`

**Estimated scope:** S

## Task 3: 更新 `runAgentLoop()` 和 `runAgentLoopContinue()` 返回契约 ✅

**Description:** 将 `runAgentLoop()` 和 `runAgentLoopContinue()` 返回类型从 `Promise<AgentMessage[]>` 改为 `Promise<void>`，删除局部 `newMessages` 初始化和 `return newMessages`。保留 prompt 初始消息进入 `currentContext.messages` 和事件流的行为。

**Acceptance criteria:**

- [x] `runAgentLoop()` 返回类型为 `Promise<void>`。
- [x] `runAgentLoopContinue()` 返回类型为 `Promise<void>`。
- [x] `runAgentLoop()` 仍将 `prompts` 合并进 `currentContext.messages`。
- [x] 初始 prompt 仍发射 `message_start` / `message_end`。
- [x] `runAgentLoopContinue()` 的空消息和 assistant 结尾保护逻辑保持不变。

**Verification:**

- [x] 运行 `bun run typecheck`。（当前被无关 `src/agent/tools/webfetch.ts` 缺少 `turndown` 类型阻断。）
- [x] 运行 `bun test src/agent/agent-loop.test.ts`。

**Dependencies:** Task 2

**Files likely touched:**

- `src/agent/agent-loop.ts`

**Estimated scope:** S

### Checkpoint: agent-loop 核心

- [x] `src/agent/agent-loop.ts` 中不存在 agent-loop 级别 `newMessages`。
- [x] `runAgentLoop()` / `runAgentLoopContinue()` 不再返回增量数组。
- [x] tool result `newMessages` 相关代码未被修改。

### Phase 3: 更新调用点

## Task 4: 更新 `Agent` 中的 `agent_end` 构造 ✅

**Description:** 调整 `src/agent/agent.ts` 里手动构造 `agent_end` 的路径，尤其是 `handleRunFailure()`。失败消息仍应直接写入 `this._state.messages`，但 `agent_end` 事件不再携带 `messages`。

**Acceptance criteria:**

- [x] `handleRunFailure()` 调用 `processEvents({ type: "agent_end" })`。
- [x] 失败消息仍写入 `this._state.messages`。
- [x] `processEvents()` 的 `agent_end` case 不读取消息 payload。
- [x] `runPromptMessages()` 和 `runContinuation()` 不依赖 `runAgentLoop()` 返回值。

**Verification:**

- [x] 运行 `bun run typecheck`。（当前被无关 `src/agent/tools/webfetch.ts` 缺少 `turndown` 类型阻断。）
- [x] 运行 `bun test src/agent/session.test.ts`。

**Dependencies:** Task 1, Task 3

**Files likely touched:**

- `src/agent/agent.ts`

**Estimated scope:** XS

### Checkpoint: 调用点

- [x] 业务调用点不再构造 `agent_end.messages`。
- [x] `Agent._state.messages` 写入路径仍只依赖 `message_end` 和失败路径显式追加。

### Phase 4: 更新测试和回归保护

## Task 5: 更新 agent loop 测试断言 ✅

**Description:** 修改 `src/agent/agent-loop.test.ts`，删除对 `runAgentLoop()` / `runAgentLoopContinue()` 返回数组的断言，改为验证事件流和上下文行为。已有事件断言应保留并加强，确保主流程、continue、error、aborted、steering、follow-up、modelOverride 行为不变。

**Acceptance criteria:**

- [x] 不再读取 `runAgentLoop()` 返回值。
- [x] 不再读取 `runAgentLoopContinue()` 返回值。
- [x] “完整流程”测试断言 assistant `message_end` 事件存在。
- [x] “continue”测试断言 assistant `message_end` 事件存在。
- [x] error / aborted 测试仍断言最后事件为 `agent_end`。

**Verification:**

- [x] 运行 `bun test src/agent/agent-loop.test.ts`。

**Dependencies:** Task 3

**Files likely touched:**

- `src/agent/agent-loop.test.ts`

**Estimated scope:** S

## Task 6: 更新 session 测试中的 `agent_end` 输入 ✅

**Description:** 修改 `src/agent/session.test.ts` 中手动派发 `agent_end` 的测试数据，从 `{ type: "agent_end", messages: [] }` 改为 `{ type: "agent_end" }`。测试目标仍然是 `AgentSession` 忽略 `agent_start` / `agent_end`。

**Acceptance criteria:**

- [x] `session.test.ts` 不再构造 `agent_end.messages`。
- [x] “should ignore agent_start and agent_end events” 语义不变。

**Verification:**

- [x] 运行 `bun test src/agent/session.test.ts`。

**Dependencies:** Task 1

**Files likely touched:**

- `src/agent/session.test.ts`

**Estimated scope:** XS

## Task 7: 验证 tool result `newMessages` 链路未回归 ✅

**Description:** 不修改 tool result `newMessages` 代码，只运行并检查相关测试，确认 `SkillTool` 仍能通过 `newMessages` 注入 `isMeta` 消息，`tool-execution.ts` 仍会把它们放入 `currentContext.pendingMessages`。

**Acceptance criteria:**

- [x] `src/agent/tool-execution.ts` 中 `executed.newMessages` 仍写入 `currentContext.pendingMessages`。
- [x] `src/agent/tools/skill.ts` 中成功路径仍返回 `newMessages: [metaUserMessage]`。
- [x] 并行工具返回多个 `newMessages` 时全部进入 `pendingMessages`。

**Verification:**

- [x] 运行 `bun test src/agent/tool-execution.test.ts`.
- [x] 运行 `bun test src/agent/tools/skill.test.ts`.

**Dependencies:** Task 5, Task 6

**Files likely touched:**

- 通常不改代码；如测试受类型变更影响，再做最小修正。

**Estimated scope:** XS

### Checkpoint: 测试回归

- [x] `bun test src/agent/agent-loop.test.ts` 通过。
- [x] `bun test src/agent/session.test.ts` 通过。
- [x] `bun test src/agent/tool-execution.test.ts` 通过。
- [x] `bun test src/agent/tools/skill.test.ts` 通过。

### Phase 5: 全局检查

## Task 8: 全局搜索旧契约残留并运行完整验证

**Description:** 搜索旧 `agent_end.messages`、agent-loop 级别 `newMessages` 以及返回值依赖，确保没有残留。最后运行类型检查和测试命令。

**Acceptance criteria:**

- [x] 不存在 `emit({ type: "agent_end", messages:`。
- [x] 不存在测试手动构造 `{ type: "agent_end", messages: ... }`。
- [x] `src/agent/agent-loop.ts` 中不存在 agent-loop 级别 `newMessages` 参数、局部变量或 `push`。
- [x] tool result `newMessages` 搜索结果只出现在 `types.ts`、`tool-execution.ts`、`skill.ts` 和相关测试/文档中。

**Verification:**

- [ ] 运行 `bun run typecheck`。（阻断：`src/agent/tools/webfetch.ts` 缺少 `turndown` 类型。）
- [x] 运行 `bun test src/agent/agent-loop.test.ts`。
- [x] 运行 `bun test src/agent/session.test.ts`。
- [x] 运行 `bun test src/agent/tool-execution.test.ts`。
- [x] 运行 `bun test src/agent/tools/skill.test.ts`。
- [ ] 运行 `bun test`。（阻断：`refer/pi-mono` 相关测试缺少 `@anthropic-ai/sdk`，随后测试进程无新输出并被停止。）

**Dependencies:** Task 5, Task 6, Task 7

**Files likely touched:**

- 无新增预期；仅根据搜索结果做小修正。

**Estimated scope:** S

### Checkpoint: Complete

- [x] 所有成功标准满足。
- [ ] 全量类型检查通过。（被无关依赖问题阻断。）
- [ ] 相关单测和全量测试通过。（相关单测通过，全量测试被无关依赖问题阻断。）
- [x] 计划外改动已排除。
- [x] 准备进入代码实现或 PR review。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| 混删 tool result `newMessages` | High | 只删除 `agent-loop.ts` 增量收集器；用 `tool-execution.test.ts` 和 `skill.test.ts` 做回归保护。 |
| 测试改成只迁就类型而未验证行为 | Medium | 用 `message_end` / `turn_end` / `agent_end` 事件断言替代返回值断言。 |
| `agent_end.messages` 存在隐藏消费者 | Medium | 全局搜索 `agent_end` 和 `.messages` 使用点；类型检查强制暴露调用点。 |
| 失败路径消息丢失 | Medium | 保留 `handleRunFailure()` 中显式写入 `this._state.messages`，只删除 `agent_end` payload。 |
| 文档或计划与实现不同步 | Low | 实现前以本计划和 spec 为准；若决定重命名 tool result `newMessages`，先更新 spec/plan。 |

## Parallelization Opportunities

- **可并行:** Task 5 和 Task 6 可在 Task 1-4 完成后并行处理测试。
- **必须顺序:** Task 1 → Task 2 → Task 3 → Task 4，因为类型契约和函数签名依赖逐层传递。
- **需要协调:** Task 7 只做回归保护，不应和删除 agent-loop `newMessages` 混成同一概念改动。

## Open Questions

- 是否在后续单独开 spec，把 tool result `newMessages` 改名为 `nextTurnMessages` 或 `injectedMessages`？
- 是否后续单独评估 `AgentToolResult.contextModifier` 是否未落地且可删除？
