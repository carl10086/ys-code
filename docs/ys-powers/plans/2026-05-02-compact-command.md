# Implementation Plan: Compact Command

## Overview

本计划基于 `docs/ys-powers/specs/2026-05-02-compact-command-design.md`，将手动 `/compact` command 拆成可逐步验证的实施任务。目标是完成手动 compact 的完整闭环：本地命令拦截、content-clearing `microcompact`、Claude Code 风格 summary、post-compact messages 重建、attachment restore、失败原子性，以及 TUI 层 `shouldQuery=false` 行为。

本期不实现 `auto compact`、`cached microcompact`、`reactive compact`、`session memory compact`。

## Architecture Decisions

- `/compact` 必须是 `local` command，不走普通 prompt command 或 `session.prompt("/compact")`。
- compact summary 使用当前会话模型，不引入独立 `compactModel`。
- 当前必须实现本地 content-clearing `microcompact`；provider-level `cache_edits` 只作为未来扩展，不进入本期验收。
- compact 成功后替换 active messages；失败或取消时 active messages 保持不变。
- compact service 与 TUI 解耦：TUI 只处理显示和 command dispatch，compact 业务逻辑位于 `src/session/compact/` 与 `AgentSession.compact()`。

## Dependency Graph

```text
AgentMessage / CommandResult 类型契约
  ↓
compact prompt / microcompact / message helpers
  ↓
compact service 编排
  ↓
AgentSession.compact() / replaceMessages()
  ↓
commands/compact + executeCommand compact result
  ↓
tui/command-utils shouldQuery=false
  ↓
integration tests / typecheck
```

关键风险在最前面：当前 `dispatchCommandResult()` 对 `handled=true` 且无 `metaMessages` 的 command 会默认调用 `session.prompt(text)`。因此必须先建立 compact 专用 command result，避免 `/compact` 被误发给主模型。

## Task List

### Phase 1: Command Contract

#### Task 1: 定义 compact command result 契约

**Description:** 扩展 command result 类型，让命令系统能表达“本地已处理且不应 query 主模型”。

**Acceptance criteria:**

- [ ] `CommandResult` 支持 `{ type: "compact"; displayText: string }`。
- [ ] `ExecuteCommandResult` 支持 `compact?: true`。
- [ ] 现有 `text`、`skip`、`prompt` command 行为不变。

**Verification:**

- [ ] Tests pass: `bun test src/commands/index.test.ts`
- [ ] Typecheck succeeds: `bun run typecheck`

**Dependencies:** None

**Files likely touched:**

- `src/commands/types.ts`
- `src/commands/index.ts`
- `src/commands/index.test.ts`

**Estimated scope:** S

#### Task 2: 让 TUI 正确处理 compact result

**Description:** 修改 `dispatchCommandResult()`，让 compact result 只显示用户命令和系统提示，不调用 `session.prompt()`。

**Acceptance criteria:**

- [ ] compact result 不触发 `session.prompt(text)`。
- [ ] UI 仍显示用户输入和 `Compacted ...`。
- [ ] 其他 command 分支不回归。

**Verification:**

- [ ] Tests pass: `bun test src/tui/command-utils.test.ts`

**Dependencies:** Task 1

**Files likely touched:**

- `src/tui/command-utils.ts`
- `src/tui/command-utils.test.ts`

**Estimated scope:** S

### Checkpoint: Command Contract

- [ ] command result 契约稳定。
- [ ] `/compact` 已具备 `shouldQuery=false` 的外层通道。
- [ ] Tests pass: `bun test src/commands/index.test.ts src/tui/command-utils.test.ts`

### Phase 2: Compact Core

#### Task 3: 建立 compact message 类型和 ordering helpers

**Description:** 新增 compact service 基础类型、`compact_boundary` message、summary message helper 和 post-compact ordering helper。

**Acceptance criteria:**

- [ ] 支持 `compact_boundary` 的 `AgentMessage` 扩展。
- [ ] `buildPostCompactMessages()` 顺序符合 spec。
- [ ] `getMessagesAfterCompactBoundary()` 只取最后一个 boundary 后的有效上下文。

**Verification:**

- [ ] Tests pass: `bun test src/session/compact/messages.test.ts`
- [ ] Typecheck succeeds: `bun run typecheck`

**Dependencies:** None

**Files likely touched:**

- `src/session/compact/types.ts`
- `src/session/compact/messages.ts`
- `src/session/compact/messages.test.ts`
- `src/agent/types.ts`

**Estimated scope:** M

#### Task 4: 实现 compact prompt

**Description:** 实现 Claude Code 风格 compact prompt、custom instructions 和 summary formatting。

**Acceptance criteria:**

- [ ] `getCompactPrompt()` 包含 no-tools preamble/trailer。
- [ ] prompt 包含 9 个 summary section。
- [ ] custom instructions 进入 `Additional Instructions`。
- [ ] `formatCompactSummary()` 移除 `<analysis>` 并格式化 `<summary>`。

**Verification:**

- [ ] Tests pass: `bun test src/session/compact/prompt.test.ts`

**Dependencies:** None

**Files likely touched:**

- `src/session/compact/prompt.ts`
- `src/session/compact/prompt.test.ts`

**Estimated scope:** S

#### Task 5: 实现 content-clearing microcompact

**Description:** 在 summary 请求前清理旧 `toolResult` 大内容，保留最近 N 个结果，并保持 toolCall/toolResult 结构配对。

**Acceptance criteria:**

- [ ] 只清理 compactable tools。
- [ ] 至少保留最近 `keepRecent` 个 `toolResult`。
- [ ] 正确统计 `tokensSaved`、`clearedToolCallIds`、`keptToolCallIds`。
- [ ] 不删除 `toolResult` 消息。
- [ ] 非 compactable `toolResult` 不被清理。

**Verification:**

- [ ] Tests pass: `bun test src/session/compact/microcompact.test.ts`

**Dependencies:** Task 3

**Files likely touched:**

- `src/session/compact/microcompact.ts`
- `src/session/compact/microcompact.test.ts`

**Estimated scope:** M

### Checkpoint: Compact Core

- [ ] compact core helpers 独立可测。
- [ ] prompt 和 microcompact 不依赖 TUI / command。
- [ ] Tests pass: `bun test src/session/compact/*.test.ts`

### Phase 3: Session Integration

#### Task 6: 实现 attachment restore 基础能力

**Description:** 从 `FileStateCache` 快照恢复最近文件 attachments；plan、skills、background tasks 先提供空扩展点。

**Acceptance criteria:**

- [ ] `FileStateCache` 可导出快照。
- [ ] 最近文件会重新读取生成 file attachment。
- [ ] 文件不存在或超预算时 graceful skip。
- [ ] skills / plan / task restore 接口存在，当前没有状态源时返回空数组。

**Verification:**

- [ ] Tests pass: `bun test src/session/compact/attachments.test.ts`

**Dependencies:** Task 3

**Files likely touched:**

- `src/agent/file-state.ts`
- `src/session/compact/attachments.ts`
- `src/session/compact/attachments.test.ts`

**Estimated scope:** M

#### Task 7: 实现 compactConversation 编排

**Description:** 串起 boundary、microcompact、summary generation、attachments 和 post-compact messages，形成 compact service 主入口。

**Acceptance criteria:**

- [ ] 使用当前会话模型生成 summary。
- [ ] summary 请求前运行 microcompact。
- [ ] 成功返回完整 `CompactionResult`。
- [ ] 失败不产生 partial result。
- [ ] 支持 prompt-too-long 后的截断重试策略。

**Verification:**

- [ ] Tests pass: `bun test src/session/compact/index.test.ts`

**Dependencies:** Tasks 3, 4, 5, 6

**Files likely touched:**

- `src/session/compact/index.ts`
- `src/session/compact/index.test.ts`
- `src/session/compact/types.ts`

**Estimated scope:** M

#### Task 8: 接入 AgentSession.compact()

**Description:** 在 `AgentSession` 暴露 compact 操作，成功后原子替换 active messages。

**Acceptance criteria:**

- [ ] `AgentSession.compact({ instructions, commandText })` 可调用 compact service。
- [ ] 成功后替换 `agent.state.messages`。
- [ ] 失败或取消时 messages 不变。
- [ ] command record 和 `local-command-stdout` meta message 进入 active messages。

**Verification:**

- [ ] Tests pass: `bun test src/agent/session.test.ts`

**Dependencies:** Task 7

**Files likely touched:**

- `src/agent/session.ts`
- `src/agent/session.test.ts`
- `src/agent/agent.ts` 或等价窄口 replace API

**Estimated scope:** M

### Checkpoint: Session Integration

- [ ] 不通过 TUI 也能完成 session compact。
- [ ] compact 成功/失败原子性有测试覆盖。
- [ ] Tests pass: `bun test src/session/compact/*.test.ts src/agent/session.test.ts`

### Phase 4: Command End-To-End

#### Task 9: 新增 `/compact` built-in command

**Description:** 添加 `src/commands/compact/`，注册到 `BUILTIN_COMMANDS`，调用 `context.session.compact()`。

**Acceptance criteria:**

- [ ] `findCommand("compact")` 能找到内置命令。
- [ ] `/compact [instructions]` 传入 `session.compact()`。
- [ ] command 返回 compact result。

**Verification:**

- [ ] Tests pass: `bun test src/commands/index.test.ts`

**Dependencies:** Tasks 1, 8

**Files likely touched:**

- `src/commands/compact/index.ts`
- `src/commands/compact/compact.ts`
- `src/commands/index.ts`
- `src/commands/index.test.ts`

**Estimated scope:** S

#### Task 10: 端到端回归和验收

**Description:** 覆盖 TUI command dispatch 到 session compact 的完整路径，并跑全量验证。

**Acceptance criteria:**

- [ ] `/compact` 不调用主模型 prompt。
- [ ] compact 后 active messages 不含旧长历史。
- [ ] custom instructions 进入 compact prompt。
- [ ] compact failure 保持原 messages。

**Verification:**

- [ ] Tests pass: `bun test`
- [ ] Typecheck succeeds: `bun run typecheck`
- [ ] Manual check: 在 TUI 输入 `/compact 只关注代码修改`

**Dependencies:** Task 9

**Files likely touched:**

- `src/tui/command-utils.test.ts`
- `src/commands/index.test.ts`
- `src/agent/session.test.ts`
- integration tests as needed

**Estimated scope:** M

### Final Checkpoint

- [ ] 所有 success criteria 满足。
- [ ] 不包含 auto compact / cached microcompact。
- [ ] Tests pass: `bun test`
- [ ] Typecheck succeeds: `bun run typecheck`
- [ ] 人工 review spec 与 plan 是否一致。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| compact summary 调用难以单测 | Med | compact service 注入 summary runner 或 mock stream |
| `Agent.state.messages` setter 不直接暴露 | Med | 在 `Agent` 或 `AgentSession` 提供窄口 `replaceMessages()` |
| session persistence 不支持 `compact_boundary` AgentMessage | Med | 先 in-memory 支持，并在 Task 3/8 明确测试持久化行为 |
| `FileStateCache` 当前不能 snapshot | Low | 增加 `entries()` 或 `snapshot()` 小接口并测试 |
| prompt-too-long 错误识别依赖 provider 文案 | Med | 先封装 `isPromptTooLongError()`，测试覆盖已知 provider 错误形态 |

## Parallelization Opportunities

Safe to parallelize after Task 3:

- Task 4 `prompt.ts`
- Task 5 `microcompact.ts`
- Task 6 `attachments.ts`

Must be sequential:

- Task 1 → Task 2 → Task 9，因为 TUI 和 command 注册依赖 command result 契约。
- Task 7 → Task 8 → Task 9，因为 command 入口依赖 session compact 能力。

Needs coordination:

- Task 3 的 `CompactionResult` / `CompactBoundaryMessage` 类型会影响 Tasks 5、6、7、8，需先稳定。

## Open Questions

- `AgentSession.compact()` 是否负责构造 `/compact` command record，还是由 command/TUI 层传入并统一记录？
- `compact_boundary` 是否应扩展现有 `Entry` schema，还是先仅作为 in-memory `AgentMessage` 并在 session persistence 中保留现有 boundary entry？
- 最近文件 attachment 的预算值是否直接采用 Claude Code 风格默认值，还是按 ys-code 当前 context window 调小？
- `getMessagesAfterCompactBoundary()` 在 restore 时应基于 session entries 还是 active messages 执行？
