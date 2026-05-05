# Implementation Plan: Compact Core Fix

## Overview

本计划实现 `docs/ys-powers/specs/2026-05-06-compact-core-fix-design.md` 中定义的手动 `/compact` 高优修复。范围只覆盖手动 `/compact`：并发错误可读、summary 结构可验证、post-compact attachments 进入 active `session.messages`，并通过 `/debug` 和 LLM View 观察实际 payload。`/sessions`、auto compact、reactive compact、session memory compact 不在本期范围内。

## Architecture Decisions

- 以 `src/session/compact/*` 为 compact 核心边界：summary check、attachment diagnostics、metadata 都在 compact 层产出，`AgentSession` 只负责并发保护和 active messages replacement。
- attachment 仍不写入 session JSONL：验收只看 active `session.messages`、`/api/debug/context` 和 normalized LLM payload。
- summary 不合格直接失败：如果 9 个章节缺失，不能替换原 messages，避免“compact 成功但上下文不可用”的假阳性。
- debug diagnostics 走 debug API 出口扩展：延续 `sop-20260502-001-llm-debug-markers.md` 的做法，不污染核心 LLM message 类型。

## Dependency Graph

```text
prompt summary rules/checker
    |
    v
compact result types + compact metadata
    |
    +--> post-compact attachment generation + diagnostics
    |        |
    |        v
    |   compactConversation() assembles boundary + summary + attachments
    |
    v
AgentSession.compact() replaces active messages safely
    |
    +--> command error mapping for known compact failures
    |
    v
/api/debug/context observes active messages + diagnostics
    |
    v
Debug Inspector renders attachment/diagnostic evidence
    |
    v
debug-compact example verifies end-to-end behavior
```

实现顺序必须从底层契约开始：先定义 summary checker 和 diagnostics 类型，再接入 `compactConversation()`，再接入 `AgentSession` / command 层，最后扩展 debug API 和示例验证。

## Task List

### Phase 1: Summary Contract

#### Task 1: 增加 compact summary 结构校验

**Description:** 在 `src/session/compact/prompt.ts` 中增加 summary validation helper，检查 formatted summary 是否包含 9 个固定章节，并返回可写入 metadata/debug 的检查结果。

**Acceptance criteria:**
- [x] `validateCompactSummary()` 或等价函数返回 `ok/missingSections/sectionCount`。
- [x] 缺任一 `COMPACT_SUMMARY_SECTIONS` 时 `ok === false`。
- [x] `formatCompactSummary()` 继续保留 secret redaction 和 `Summary:\n` 前缀。

**Verification:**
- [x] Tests pass: `bun test ./src/session/compact/prompt.test.ts`
- [x] 新测试覆盖完整 summary、缺章节 summary、plain text summary。

**Dependencies:** None

**Files likely touched:**
- `src/session/compact/prompt.ts`
- `src/session/compact/prompt.test.ts`

**Estimated scope:** S

#### Task 2: 让 summary 不合格时 compact 失败且不替换 messages

**Description:** 在 `compactConversation()` 生成 formatted summary 后执行 summary check；不合格时抛出明确错误，并确保 `AgentSession.compact()` 不执行 `replaceMessages()`。

**Acceptance criteria:**
- [ ] summary 缺章节时 `compactConversation()` reject，错误信息包含缺失章节信息。
- [ ] summary 合格时 `compactMetadata.summaryCheck` 或等价字段记录检查结果。
- [ ] 失败时 `AgentSession` active messages 保持不变。

**Verification:**
- [ ] Tests pass: `bun test ./src/session/compact/index.test.ts ./src/agent/session.test.ts`
- [ ] 新测试覆盖不合格 summary 不替换 messages。

**Dependencies:** Task 1

**Files likely touched:**
- `src/session/compact/types.ts`
- `src/session/compact/messages.ts`
- `src/session/compact/conversation.ts`
- `src/session/compact/index.test.ts`
- `src/agent/session.test.ts`

**Estimated scope:** M

### Checkpoint: Summary Contract

- [ ] `bun test ./src/session/compact/prompt.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts`
- [ ] 手动检查：不合格 summary 错误可读，且不会覆盖 active messages。
- [ ] 与用户确认 summary 失败策略仍符合预期。

### Phase 2: Attachment Restore and Diagnostics

#### Task 3: 为 file restore attachment 增加 diagnostics 和 skip reason

**Description:** 将 `createPostCompactFileAttachments()` 从只返回数组扩展为返回 `{ attachments, diagnostics }`，记录 generated attachments 和每个跳过原因。保留安全过滤：partial view、workspace 外路径、敏感路径、secret、大小限制。

**Acceptance criteria:**
- [ ] 无 fileStateCache entries 时返回 `skipped: no fileStateCache entries`。
- [ ] partial read、missing file、workspace 外路径、敏感路径、secret、size budget 都有明确 skip reason。
- [ ] 成功生成 file attachment 时 diagnostics 包含类型和 display path。

**Verification:**
- [ ] Tests pass: `bun test ./src/session/compact/attachments.test.ts`
- [ ] 现有 file attachment 行为保持：使用 cached read content，不重新扩大 partial read。

**Dependencies:** None

**Files likely touched:**
- `src/session/compact/attachments.ts`
- `src/session/compact/attachments.test.ts`

**Estimated scope:** M

#### Task 4: 补齐 skill/plan restore 的最小实现或显式 unsupported diagnostics

**Description:** 按现有状态能力实现 skill/plan restore。若 YS 当前没有稳定状态来源，则至少返回明确 skip reason，不再静默返回空数组。背景任务本期不实现时也要在 diagnostics 中标记 unsupported。

**Acceptance criteria:**
- [ ] `createSkillRestoreAttachments()` 有输入状态或 skip reason，不能静默空数组。
- [ ] `createPlanRestoreAttachments()` 有输入状态或 skip reason，不能静默空数组。
- [ ] background task 本期若不实现，diagnostics 明确 `unsupported in this phase`。

**Verification:**
- [ ] Tests pass: `bun test ./src/session/compact/attachments.test.ts`
- [ ] 新测试覆盖 skill/plan 有状态和无状态路径；若无稳定状态来源，覆盖 skip reason。

**Dependencies:** Task 3

**Files likely touched:**
- `src/session/compact/attachments.ts`
- `src/session/compact/attachments.test.ts`
- 可能只读参考 `src/agent/session.ts` 的 `sentSkillNames`

**Estimated scope:** M

#### Task 5: 将 attachment diagnostics 接入 compactConversation metadata

**Description:** `compactConversation()` 聚合 file/skill/plan/background diagnostics，把 attachments 放入 `postCompactMessages`，并把 diagnostics 写入 compact result/metadata，供 `AgentSession` 和 debug API 使用。

**Acceptance criteria:**
- [ ] compact 成功后 `result.attachments` 包含生成的 active context attachments。
- [ ] `boundaryMessage.compactMetadata.attachmentStats` 或等价字段包含 generated/skipped/reasons。
- [ ] 无 attachment 时仍能从 metadata/debug 看到 skip reason。

**Verification:**
- [ ] Tests pass: `bun test ./src/session/compact/index.test.ts ./src/session/compact/messages.test.ts`
- [ ] 新测试覆盖有 file attachment 和无 attachment 两种 compact result。

**Dependencies:** Task 2, Task 3, Task 4

**Files likely touched:**
- `src/session/compact/types.ts`
- `src/session/compact/messages.ts`
- `src/session/compact/conversation.ts`
- `src/session/compact/index.test.ts`
- `src/session/compact/messages.test.ts`

**Estimated scope:** M

### Checkpoint: Compact Core Result

- [ ] `bun test ./src/session/compact/*.test.ts`
- [ ] `compactConversation()` 合格 summary + attachment restore 的核心路径通过。
- [ ] `compactConversation()` 不合格 summary、无 attachment、attachment 被安全规则跳过的路径都有明确诊断。

### Phase 3: Agent and Command Behavior

#### Task 6: 确保 AgentSession 成功 compact 后 active messages 保留 attachments

**Description:** 验证并调整 `AgentSession.compact()` 的 post-compact assembly，确保 `agent.replaceMessages(postCompactMessages)` 使用包含 attachments 的结果，同时 session persistence 不作为验收目标。

**Acceptance criteria:**
- [ ] 手动 compact 成功后 `session.messages` 包含 `role: "attachment"`。
- [ ] `/compact` command/stdout keep messages 仍保留。
- [ ] summary 不合格或 messages changed 时不会替换 active messages。

**Verification:**
- [ ] Tests pass: `bun test ./src/agent/session.test.ts`
- [ ] 新测试直接断言 active messages 中 attachment 存在。

**Dependencies:** Task 5

**Files likely touched:**
- `src/agent/session.ts`
- `src/agent/session.test.ts`

**Estimated scope:** S

#### Task 7: 映射已知 compact 错误为用户可读命令结果

**Description:** 在 command execution 层或 compact command 层识别 compact 专属错误，保留日志根因，同时把 `Compact is already in progress` 和 `Cannot compact while a model response is streaming` 转成明确提示。

**Acceptance criteria:**
- [ ] 并发 compact 显示“Compact 正在进行中，请等待完成后重试”或等价明确文案。
- [ ] streaming 中 compact 显示“模型仍在响应，请等待结束后重试”或等价明确文案。
- [ ] 未知错误仍记录 `Local command failed` 并显示通用失败提示。

**Verification:**
- [ ] Tests pass: `bun test ./src/commands/index.test.ts ./src/agent/session.test.ts`
- [ ] 新测试覆盖两个已知 compact 错误的 `textResult`。

**Dependencies:** None

**Files likely touched:**
- `src/commands/index.ts`
- `src/commands/index.test.ts`
- 可能 `src/commands/compact/compact.ts`

**Estimated scope:** S

### Checkpoint: User-Facing Manual Compact

- [ ] `bun test ./src/commands/index.test.ts ./src/agent/session.test.ts ./src/session/compact/*.test.ts`
- [ ] 手动复现重复 `/compact`，看到明确错误。
- [ ] 手动 compact 成功后 active messages 中保留 attachments。

### Phase 4: Debug Observability

#### Task 8: 扩展 DebugContextResponse 的 compact diagnostics

**Description:** 在 `/api/debug/context` 返回 active attachment summary、compact boundary metadata、normalized LLM attachment evidence。保持 `_debug.source` 的现有 debug-only 设计。

**Acceptance criteria:**
- [ ] `DebugContextResponse` 包含 `compactDiagnostics` 或等价字段。
- [ ] diagnostics 显示 active attachment count/type。
- [ ] diagnostics 显示 latest compact boundary metadata 中的 summary check 和 attachment stats。
- [ ] LLM View 中 attachment system-reminder 仍标记 `_debug.source === "attachment"`。

**Verification:**
- [ ] Tests pass: `bun test ./src/web/debug/debug-api.test.ts`
- [ ] 新测试覆盖有 attachment、无 attachment 但有 skip reason、无 compact boundary。

**Dependencies:** Task 5, Task 6

**Files likely touched:**
- `src/web/debug/debug-api.ts`
- `src/web/debug/debug-api.test.ts`

**Estimated scope:** M

#### Task 9: 在 Debug Inspector 页面展示 compact diagnostics

**Description:** 在 `src/web/debug/debug.html.ts` 增加一个轻量 diagnostics 展示区，显示 attachment count/type、summary check、skip reasons。Messages 和 LLM View 原有展示继续保留。

**Acceptance criteria:**
- [ ] `/debug` 页面能直接看到 attachment generated/skipped 概览。
- [ ] skip reason 可展开查看。
- [ ] 现有 tabs 和 message toggle 行为不回归。

**Verification:**
- [ ] Tests pass: `bun test ./src/web/debug-inspector-e2e.test.ts ./src/web/debug/debug-api.test.ts`
- [ ] 手动打开 `/debug`，确认 diagnostics 可见。

**Dependencies:** Task 8

**Files likely touched:**
- `src/web/debug/debug.html.ts`
- `src/web/debug-inspector-e2e.test.ts`

**Estimated scope:** M

### Checkpoint: Debug Observability

- [ ] `bun test ./src/web/debug/debug-api.test.ts ./src/web/debug-inspector-e2e.test.ts`
- [ ] `/debug` Messages 可见 active attachment。
- [ ] `/debug` LLM View 可见 `<system-reminder>` 且 `_debug.source === "attachment"`。
- [ ] `/debug` diagnostics 能解释无 attachment 的原因。

### Phase 5: End-to-End Example

#### Task 10: 更新 debug compact 示例覆盖 summary + attachment + diagnostics

**Description:** 更新 `examples/debug-compact.ts` 和测试，让示例先制造 Read/fileStateCache 场景，再执行 `/compact`，最后输出/断言 post-compact active messages、LLM View 和 diagnostics。

**Acceptance criteria:**
- [ ] 示例输出包含 latest transcript/session 信息之外，还包含 active attachment count/type。
- [ ] 示例或测试验证 summary 包含 9 个章节。
- [ ] 示例或测试验证无 attachment 场景有 skip reason。

**Verification:**
- [ ] Tests pass: `bun test ./examples/debug-compact.test.ts`
- [ ] Manual check: `bun run examples/debug-compact.ts`

**Dependencies:** Task 8

**Files likely touched:**
- `examples/debug-compact.ts`
- `examples/debug-compact.test.ts`

**Estimated scope:** M

### Final Checkpoint: Complete

- [ ] `bun test ./src/session/compact/*.test.ts ./src/agent/session.test.ts ./src/commands/index.test.ts ./src/web/debug/debug-api.test.ts ./src/web/debug-inspector-e2e.test.ts ./examples/debug-compact.test.ts`
- [ ] `bun run typecheck`
- [ ] Manual `/compact` duplicate trigger shows readable error.
- [ ] Manual `/compact` after file Read shows attachment in `/debug` Messages.
- [ ] `/debug` LLM View shows attachment `<system-reminder>` with `_debug.source === "attachment"`.
- [ ] No changes to `/sessions`, session JSONL attachment persistence, auto compact, reactive compact, or session memory compact.

## Parallelization Opportunities

- Safe to parallelize after Task 2: Task 3/4 attachment diagnostics and Task 7 command error mapping are mostly independent.
- Must be sequential: Task 5 depends on summary metadata and attachment diagnostics contracts.
- Must be sequential: Task 8/9 debug work depends on compact metadata shape from Task 5.
- Task 10 should happen last because it validates the integrated flow.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Summary checker too strict breaks real model output | High | Validate against exact section headings defined in prompt; keep error explicit and test common formatting variants only if approved |
| Attachment diagnostics change return types across many callers | Medium | Introduce wrapper result and update compact callers in one task; keep old helper shape only if needed by tests |
| Skill/plan restore lacks stable state source | Medium | Implement explicit skip reason first; only generate attachment when state source is confirmed |
| Debug API mistakes userContext `<system-reminder>` for compact attachment | Medium | Diagnostics should use active `messages.role === "attachment"` and compact metadata, not only string heuristics |
| Command error mapping hides unknown errors | Medium | Only map exact known compact errors; keep logger.warn with original message |
| Tasks grow too large | Medium | Stop after each checkpoint and run focused tests before continuing |

## Open Questions

- skill restore 是否应只根据 `sentSkillNames` 生成轻量提示，还是需要保存 skill 内容？当前计划先要求“有状态则生成，否则 skip reason”。
- plan / plan mode 的稳定状态源是否已经存在？若不存在，本期只做 skip reason。
- background task attachment 是否完全排除，还是在 diagnostics 中标记 unsupported？当前计划采用 unsupported diagnostics。

