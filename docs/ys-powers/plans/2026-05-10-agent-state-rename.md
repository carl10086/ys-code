# Agent 状态层重构实施计划

**基于 Spec**: `docs/ys-powers/specs/2026-05-08-agent-state-rename-design.md`

---

## 依赖关系图

```
types.ts (基础层)
  ├── AgentInput ──→ agent-loop.ts ──→ agent.ts
  ├── AgentView  ──→ agent.ts
  └── AgentRuntime ──→ stream-assistant.ts
                      ──→ tool-execution.ts

stream-assistant.ts ──→ agent-loop.ts (调用关系)
tool-execution.ts    ──→ agent-loop.ts (调用关系)
```

**关键依赖**：`types.ts` 是所有 slice 的基础，但 slice 1 只重命名已有类型，slice 2/3 才引入新类型。因此 slice 1 可以独立先行。

---

## Checkpoint 1: 类型重命名完成

### Slice 1: AgentContext→AgentInput, AgentState→AgentView 重命名

**目标**：完成核心类型的重命名，更新所有引用点，确保编译和测试通过。

**涉及文件**：
- `src/agent/types.ts` — 类型定义
- `src/agent/agent.ts` — Agent 类引用
- `src/agent/agent.test.ts` — 测试引用

**变更清单**：

1. **types.ts**
   - `AgentContext` → `AgentInput`
   - `AgentState` → `AgentView`
   - 保留 `messages` 在 `AgentInput` 中（Slice 3 才移除）

2. **agent.ts**
   - 导入更新
   - `MutableAgentState` → `MutableAgentView`
   - `get state(): AgentView`
   - `systemPrompt: (input: AgentInput) => Promise<SystemPrompt>`
   - `createContextSnapshot()` → `createInputSnapshot()`（返回 `AgentInput`）

3. **agent.test.ts**
   - `AgentState` → `AgentView` 引用更新
   - 构造函数参数类型更新

**验收标准**：
- [ ] `npx tsc --noEmit` 在 `src/agent/` 下无类型错误
- [ ] `bun test src/agent/agent.test.ts` 全部通过
- [ ] `grep -r "AgentContext\|AgentState" src/agent/` 无残留（除注释外）

**验证命令**：
```bash
cd src/agent && npx tsc --noEmit && bun test agent.test.ts
```

---

## Checkpoint 2: 运行时类型层完成

### Slice 2: LoopState 内部化 + AgentRuntime 提取

**目标**：LoopState 保留在 agent-loop.ts 内部，创建 AgentRuntime 供下游函数使用，tool-execution 完成适配。

**涉及文件**：
- `src/agent/types.ts` — 新增 `AgentRuntime`
- `src/agent/agent-loop.ts` — LoopState 字段直接声明，去掉 `AgentContext["xxx"]`
- `src/agent/tool-execution.ts` — `AgentContext` → `AgentRuntime`
- `src/agent/tool-execution.test.ts` — Mock 数据结构调整

**变更清单**：

1. **types.ts**
   - 新增 `AgentRuntime` 接口（messages/tools/sentSkillNames/invokedSkills）

2. **agent-loop.ts**
   - `LoopState` 字段改为直接声明类型（`tools?: AgentTool[]` 而非 `AgentContext["tools"]`）
   - `LoopState` 仍保留在文件内部，不导出

3. **tool-execution.ts**
   - 导入 `AgentRuntime` 替代 `AgentContext`
   - 所有函数签名 `currentContext: AgentContext` → `runtime: AgentRuntime`
   - 内部访问方式不变（`runtime.messages`, `runtime.tools` 等）

4. **tool-execution.test.ts**
   - `createMockContext()` → `createMockRuntime()`
   - Mock 数据包含 `messages` 字段

**验收标准**：
- [ ] `npx tsc --noEmit` 无错误
- [ ] `bun test src/agent/tool-execution.test.ts` 全部通过
- [ ] `LoopState` 未出现在 `types.ts` 导出列表中
- [ ] `grep "AgentContext\[" src/agent/agent-loop.ts` 无残留

**验证命令**：
```bash
cd src/agent && npx tsc --noEmit && bun test tool-execution.test.ts
```

---

## Checkpoint 3: 去副作用化完成

### Slice 3: stream-assistant 去副作用化 + agent-loop 签名调整

**目标**：消除 `streamAssistantResponse` 对 messages 的 mutate，agent-loop 统一控制状态更新。

**涉及文件**：
- `src/agent/stream-assistant.ts` — 去副作用化
- `src/agent/stream-assistant.test.ts` — 新增无副作用断言
- `src/agent/agent-loop.ts` — 签名调整 + state 统一更新
- `src/agent/agent-loop.test.ts` — 测试数据结构调整

**变更清单**：

1. **stream-assistant.ts**
   - `generateAttachments(context, ...)` → `generateAttachments(messages, sentSkillNames, ...)`
   - `streamAssistantResponse(context, ...)` → `streamAssistantResponse(runtime: AgentRuntime, ...)`
   - 移除所有 `runtime.messages.push(...)` 和 `runtime.messages[...] = ...`
   - `finalizeStreamMessage` 只 emit 事件，不操作数组
   - stream 过程中通过 `emit({ type: "message_update", ... })` 传递进度

2. **agent-loop.ts**
   - `runAgentLoop(prompts, context, ...)` → `runAgentLoop(messages, prompts, input, ...)`
   - `runAgentLoopContinue(context, ...)` → `runAgentLoopContinue(messages, input, ...)`
   - `AgentContext` → `AgentInput`（参数类型）
   - `state.messages` 更新改为 loop 显式控制：
     ```typescript
     const assistantMessage = await streamAssistantResponse(runtime, ...);
     messages.push(assistantMessage); // loop 统一更新
     ```

3. **stream-assistant.test.ts**
   - 新增测试：验证 `streamAssistantResponse` 调用前后 `runtime.messages` 长度不变
   - 更新现有测试以使用 `AgentRuntime` 替代 `AgentContext`

4. **agent-loop.test.ts**
   - `createMockContext()` → `createMockInput()`（不含 messages）
   - `runAgentLoop` 调用增加 `messages` 参数
   - 验证 state 更新顺序

**验收标准**：
- [ ] `npx tsc --noEmit` 无错误
- [ ] `bun test src/agent/stream-assistant.test.ts` 全部通过
- [ ] `bun test src/agent/agent-loop.test.ts` 全部通过
- [ ] `grep "messages.push\|messages\[" src/agent/stream-assistant.ts` 无残留（除注释外）

**验证命令**：
```bash
cd src/agent && npx tsc --noEmit && bun test stream-assistant.test.ts agent-loop.test.ts
```

---

## Checkpoint 4: 集成验证完成

### Slice 4: 全量集成验证

**目标**：确认所有模块协同工作，无回归。

**涉及文件**：
- 所有 `src/agent/*.ts`
- 所有 `src/agent/*.test.ts`
- `src/session/*.ts`（确认是否调用 `runAgentLoop`）

**验证清单**：

1. **编译检查**
   ```bash
   npx tsc --noEmit
   ```

2. **全量测试**
   ```bash
   bun test src/agent/
   ```

3. **影响范围扫描**
   ```bash
   grep -r "AgentContext\|AgentState" src/ --include="*.ts"
   # 预期：除历史注释外无残留
   ```

4. **关键路径走查**
   - `Agent.run()` → `runAgentLoop()` → `streamAssistantResponse()` → 返回 → loop 更新 messages
   - `Agent.steer()` → 触发 steering → 下轮注入 messages
   - Tool 执行 → `executeToolCalls()` → 返回 toolResults → loop 更新 messages

**验收标准**：
- [ ] 全量 TypeScript 编译通过（`npx tsc --noEmit` 0 错误）
- [ ] 全量测试通过（`bun test src/agent/` 0 失败）
- [ ] 无 `AgentContext` / `AgentState` 残留引用
- [ ] 手动走查确认附件、steering、tool 执行三条路径正常

---

## 回滚策略

每个 slice 完成后立即 commit：

```bash
# Slice 1
git add src/agent/types.ts src/agent/agent.ts src/agent/agent.test.ts
git commit -m "refactor(agent): rename AgentContext→AgentInput, AgentState→AgentView"

# Slice 2
git add src/agent/types.ts src/agent/agent-loop.ts src/agent/tool-execution.ts src/agent/tool-execution.test.ts
git commit -m "refactor(agent): extract AgentRuntime, internalize LoopState"

# Slice 3
git add src/agent/stream-assistant.ts src/agent/stream-assistant.test.ts src/agent/agent-loop.ts src/agent/agent-loop.test.ts
git commit -m "refactor(agent): remove messages mutation from streamAssistantResponse"

# Slice 4（如发现问题）
git revert HEAD~N..HEAD  # 按需回滚到最近稳定的 slice
```

---

## 风险应对

| 风险 | 触发条件 | 应对 |
|------|---------|------|
| Slice 1 改不完 | AgentState/AgentContext 引用太多 | 用 `sed` 批量替换，优先保证编译通过 |
| Slice 3 事件顺序错乱 | stream-assistant 去副作用后 TUI 不更新 | 对比改前后的 `emit` 序列，确保事件类型和顺序一致 |
| session 层调用者未更新 | `src/session/` 调用 `runAgentLoop` | Slice 4 扫描发现后立即修复 |
| 测试 mock 数据不兼容 | 新类型缺少字段导致测试崩溃 | 补充 mock 辅助函数，不硬编码在每个测试里 |
