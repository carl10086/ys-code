# Agent Loop 消息机制简化 — 实施计划

## 目标

基于 Spec `docs/ys-powers/specs/2026-05-08-agent-loop-message-simplification-design.md`，将 `agent-loop.ts` 改造为单层 `while(true)` 结构，删除 `followUp` / `pendingMessages` / `modelOverride` / `contextModifier` 等死代码，保留 `steering` 功能。

---

## 依赖图

```
types.ts（最底层，先改）
├── agent.ts ──► session.ts
├── tool-execution.ts ──► agent-loop.ts
└── tools/skill.ts
```

**变更顺序约束**：
1. `types.ts` 必须先改（删除类型字段），否则下游编译失败
2. `tool-execution.ts` 必须在 `agent-loop.ts` 之前改（返回类型变更）
3. `agent.ts` / `session.ts` / `skill.ts` 可在 `types.ts` 之后并行修改

---

## 任务列表

### Task 1: 删除 types.ts 中的死字段

**范围**: `src/agent/types.ts`

**变更内容**:
- 从 `AgentContext` 删除 `pendingMessages?: AgentMessage[]`
- 从 `AgentContext` 删除 `modelOverride?: string`
- 从 `AgentToolResult` 删除 `contextModifier?: (messages: AgentMessage[]) => AgentMessage[]`
- 从 `AgentToolResult` 删除 `modelOverride?: string`
- 从 `AgentLoopConfig` 删除 `getFollowUpMessages?: () => Promise<AgentMessage[]>`

**验收标准**:
- `bun run typecheck` 通过（会触发下游编译错误，属于预期，后续任务修复）
- `AgentContext` / `AgentToolResult` / `AgentLoopConfig` 不再包含已删除字段

**验证步骤**:
```bash
bun run typecheck
```

---

### Task 2: 清理 agent.ts / session.ts / skill.ts 中的死代码

**范围**:
- `src/agent/agent.ts`
- `src/agent/session.ts`
- `src/agent/tools/skill.ts`
- `src/agent/tools/skill.test.ts`

**变更内容**:

**agent.ts**:
- 删除 `followUpQueue` 字段
- 删除 `followUpMode` getter/setter
- 删除 `followUp()` 方法
- 删除 `clearFollowUpQueue()` 方法
- 删除 `AgentOptions.followUpMode`
- `clearAllQueues()` 简化为只调用 `clearSteeringQueue()`
- `hasQueuedMessages()` 简化为只检查 `steeringQueue.hasItems()`
- `reset()` 删除 `clearFollowUpQueue()` 调用
- `continue()` 删除 followUp 分支（只剩 steering 检查和 error throw）
- `createLoopConfig()` 删除 `getFollowUpMessages`

**session.ts**:
- 删除 `followUp()` 两个重载方法

**skill.ts**:
- 从 `SkillOutputSchema` 删除 `contextModifier` 和 `modelOverride` 字段
- 从 `execute` 返回值删除 `contextModifier` 和 `modelOverride`

**skill.test.ts**:
- 删除 modelOverride 相关测试
- 删除 contextModifier 相关测试（如有）

**验收标准**:
- 以上文件编译通过
- `agent.ts` 中不再引用 `followUpQueue` / `followUp` / `followUpMode`
- `session.ts` 中不再有 `followUp` 方法
- `skill.ts` 返回类型不再包含 `contextModifier` / `modelOverride`

**验证步骤**:
```bash
bun run typecheck
```

---

### Task 3: 改造 tool-execution.ts 返回 newMessages（含测试）

**范围**:
- `src/agent/tool-execution.ts`
- `src/agent/tool-execution.test.ts`

**变更内容（实现）**:
- `executeToolCalls` 返回类型改为 `Promise<{ toolResults: ToolResultMessage[]; newMessages: AgentMessage[] }>`
- `executePreparedToolCall` 返回值删除 `contextModifier` 和 `modelOverride` 提取逻辑
- `finalizeExecutedToolCall` 的 `executed` 参数删除 `modelOverride`
- `executeToolCallsSequential` 中：
  - 删除 `currentContext.pendingMessages` 写入逻辑
  - 删除 `currentContext.modelOverride` 写入逻辑
  - 收集所有 `newMessages`，合并后返回
- `executeToolCallsParallel` 中：
  - 删除 `currentContext.pendingMessages` 写入逻辑
  - 删除 `currentContext.modelOverride` 写入逻辑
  - 收集所有 `newMessages`，合并后返回
- `executeToolCalls` 返回 `{ toolResults, newMessages }`

**变更内容（测试）**:
- 删除 "工具返回 newMessages 时加入 currentContext.pendingMessages" 测试
- 删除 "工具返回 modelOverride 时写入 currentContext.modelOverride" 测试
- 删除 "多个工具返回 modelOverride 时后者覆盖前者" 测试
- 删除 "并行执行时 modelOverride 由第一个有 override 的工具决定" 测试
- 删除 "并行执行时混合 newMessages 和 modelOverride 都正确处理" 测试
- 新增测试：验证 `executeToolCalls` 返回 `{ toolResults, newMessages }`，且 `newMessages` 不为空时 `context` 未被修改

**验收标准**:
- `executeToolCalls` 不再修改 `currentContext`
- `executeToolCalls` 返回的 `newMessages` 包含所有工具返回的 newMessages（顺序保持）
- `tool-execution.test.ts` 全部通过
- 测试中不再断言 `context.pendingMessages` 或 `context.modelOverride`

**验证步骤**:
```bash
bun run typecheck
bun test ./src/agent/tool-execution.test.ts
```

---

### Task 4: 重写 agent-loop.ts

**范围**: `src/agent/agent-loop.ts`

**变更内容**:
- 删除 `runTurnOnce` 函数
- 删除 `runLoop` 函数
- 重写 `runAgentLoop`：
  - 初始化 `LoopState`（`messages`, `tools`, `pendingToolNewMessages`, `pendingSteering`, `turnCount`）
  - 预发射 `agent_start` + `turn_start` + prompt 消息事件
  - 单层 `while(true)` 循环，所有逻辑内联：
    1. 解构 state
    2. 组合 `toInject = [...pendingSteering, ...pendingToolNewMessages]`
    3. `turnCount > 0` 时发射 `turn_start`
    4. 注入消息并发射事件
    5. 调用 `streamAssistantResponse`
    6. 执行工具（如有）
    7. 发射 `turn_end`
    8. error/aborted 检查
    9. 末尾 drain steering
    10. `shouldContinue` 判断
    11. 构建 next state，推进 `state = next`
- 重写 `runAgentLoopContinue`：
  - 保留消息非空和最后一条非 assistant 的校验
  - 预发射 `agent_start` + `turn_start`
  - 直接重复 `runAgentLoop` 中的 `while(true)` 循环体（不提取共享函数）

**验收标准**:
- `agent-loop.ts` 中不存在 `runTurnOnce` 或 `runLoop` 函数
- 循环为单层 `while(true)`
- `streamAssistantResponse` 和 `executeToolCalls` 的调用参数包含完整的 `AgentContext` 字段（`sentSkillNames`, `invokedSkills`）

**验证步骤**:
```bash
bun run typecheck
```

---

### Task 5: 更新 agent-loop.test.ts

**范围**: `src/agent/agent-loop.test.ts`

**变更内容**:
- 删除 "followUpMessages 在即将停止时触发新一轮" 测试
- 改造 "工具返回的 newMessages 会注入到后续 turn 的模型上下文" 测试：删除 `context.pendingMessages` 相关断言，改为验证 `executeToolCalls` 返回 `newMessages`，且这些消息在下一轮被正确注入 LLM 上下文
- 删除 `runAgentLoop modelOverride` 全部测试
- 删除 "stream 抛出异常后仍恢复原始模型" 测试
- 删除 "runLoop 控制流结构" 测试中 `runTurnOnce` 存在性断言，改为断言 `runTurnOnce` **不存在**
- 新增测试：验证 `stopReason === "error"` 时 `turn_end` 先于 `agent_end` 发射
- 新增测试：验证 steering 在 tool calls 之后到达时，会在下一轮正确注入

**验收标准**:
- `agent-loop.test.ts` 全部通过
- 测试中不再引用 `getFollowUpMessages` / `modelOverride` / `pendingMessages`

**验证步骤**:
```bash
bun test ./src/agent/agent-loop.test.ts
```

---

### Task 6: 全量回归验证

**范围**: 整个 `src/agent/` 目录及全量测试

**变更内容**:
- 运行全量类型检查
- 运行全量单元测试
- 检查是否有未更新的引用（如 `context.pendingMessages`、`modelOverride`、`getFollowUpMessages`）

**验收标准**:
- `bun run typecheck` 零错误
- `bun test` 全部通过
- 全局 grep 确认无残留引用：
  - `pendingMessages`（除注释外）
  - `modelOverride`（除注释外）
  - `getFollowUpMessages`（除注释外）
  - `contextModifier`（除注释外）
  - `followUpQueue` / `followUpMode`（除注释外）

**验证步骤**:
```bash
bun run typecheck
bun test
# 残留检查
grep -r "pendingMessages" src/agent/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "//"
grep -r "modelOverride" src/agent/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "//"
grep -r "getFollowUpMessages" src/agent/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "//"
grep -r "contextModifier" src/agent/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "//"
grep -r "followUpQueue\|followUpMode" src/agent/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "//"
```

---

## 检查点

| 检查点 | 触发条件 | 验证命令 |
|--------|---------|---------|
| **CP1: Phase 1 完成** | Task 1 + Task 2 完成 | `bun run typecheck`（预期 `agent-loop.ts` 和 `tool-execution.ts` 有编译错误，后续 Task 修复） |
| **CP2: Phase 2 完成** | Task 3 完成 | `bun test ./src/agent/tool-execution.test.ts` |
| **CP3: Phase 3 完成** | Task 4 + Task 5 完成 | `bun test ./src/agent/agent-loop.test.ts` |
| **CP4: 全量验证** | Task 6 完成 | `bun run typecheck && bun test` |

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Task 1 删除类型字段后，下游大量编译错误 | 预期内，Task 2-4 会逐个修复 |
| `agent-loop.ts` 重写后事件顺序改变 | Task 5 中新增事件顺序断言；CP3 验证 |
| `pendingSteering` 机制理解错误导致 steering 丢失 | Task 5 中新增 steering 在 tool calls 后注入的测试；CP3 验证 |
| `streamAssistantResponse` 的 mutation 副作用导致消息重复或丢失 | 保留现有的 `message_end` 事件处理逻辑（`agent.ts` 的 `processEvents`）；CP4 全量验证 |

---

## 回滚策略

- 每个 Task 完成后单独 commit，便于 bisect 和 revert
- 如 CP4 发现不可快速修复的 regression，回滚到最后一个通过 CP 的 commit
