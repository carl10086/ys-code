# Implementation Plan: Compact P0 Attachment Alignment

## Overview

本计划实现 `docs/ys-powers/specs/2026-05-06-compact-p0-attachment-alignment-design.md` 中定义的 P0 对齐范围：真实恢复已调用 skill 的内容为 `invoked_skills` attachment，并为 `plan_file_reference` / `plan_mode` 建立 attachment contract 与 unsupported diagnostics。范围严格限制在 P0：不实现 background `task_status`、deferred tools、agent listing、MCP instructions，也不新增持久化 plan state。

## Architecture Decisions

- `invokedSkills` 状态放在 Agent state 中，与现有 `sentSkillNames` 同级；本阶段不写入 session JSONL。
- SkillTool 不直接持有外部状态；它通过 tool output/details 暴露 `skillName/source/content/invokedAt`，由 AgentSession 在 `message_end` 处理 `toolResult` 时记录。
- `PromptCommand` 增加可选 `sourcePath` 字段，加载 project/user/bundled skill 时尽量填充；无法填充时允许空字符串并记录 diagnostics。
- 新 attachment 类型采用 additive union：保留现有 `file | directory | skill_listing` 行为。
- restore 生成函数返回 `{ attachments, diagnostics }`，由 `compactConversation()` 聚合进 `CompactionResult` 和 `compactMetadata.attachmentStats`。
- plan/plan_mode 本阶段只建立类型、normalize contract、unsupported diagnostics，不读取文件、不发明 plan state。

## Dependency Graph

```text
PromptCommand sourcePath contract
    |
    v
SkillTool output details with invoked skill metadata
    |
    v
Agent state records invokedSkills
    |
    v
Attachment union + normalize invoked_skills / plan contracts
    |
    v
compact attachment generators return attachments + diagnostics
    |
    v
compactConversation aggregates result + compactMetadata.attachmentStats
    |
    v
AgentSession.compact passes invokedSkills and preserves active attachments
```

实现顺序必须先完成类型和状态来源，再做 restore attachment 生成；否则 compact 层只能拿到 skill 名称，无法满足 P0 的“内容恢复”目标。

## Task List

### Phase 1: Invoked Skill State Foundation

#### Task 1: 为 PromptCommand 和 SkillTool 输出补齐 invoked skill metadata

**Description:** 扩展 `PromptCommand` 的可选来源路径字段，并让 `SkillTool.execute()` 成功执行后在 output/details 中返回 `skillName`、`skillPath`、`skillContent`、`invokedAt`。这一步只建立可观测 metadata，不改变 agent state。

**Acceptance criteria:**
- [x] `PromptCommand` 支持可选 `sourcePath` 或等价字段。
- [x] 加载 project/user/bundled prompt command 时能填充可获得的 source path；无法获得时字段可为空。
- [x] `SkillTool.execute()` 成功时 details 中包含 skill restore metadata。
- [x] 失败或 validation 未通过时不记录成功的 invoked skill metadata。

**Verification:**
- [x] Tests pass: `bun test ./src/agent/tools/skill.test.ts`
- [x] 新测试断言 SkillTool 成功 output 中包含 `skillName/skillContent/invokedAt`。
- [x] Type check passes for command loader changes.

**Dependencies:** None

**Files likely touched:**
- `src/commands/types.ts`
- `src/commands/loadCommandsDir.ts`
- `src/skills/loadSkillsDir.ts`
- `src/agent/tools/skill.ts`
- `src/agent/tools/skill.test.ts`

**Estimated scope:** M

#### Task 2: 在 Agent state 中记录 invokedSkills

**Description:** 在 Agent state 中增加 `invokedSkills` map/record，并在 AgentSession 处理成功 `toolResult` 时从 details 中提取 SkillTool metadata，写入最新调用记录。重复调用同一 skill 时用最新 `invokedAt/content` 覆盖旧记录。

**Acceptance criteria:**
- [x] Agent state 类型包含 `invokedSkills`。
- [x] `AgentSession` 能在 SkillTool 成功 toolResult 后记录 invoked skill。
- [x] 非 SkillTool、失败 toolResult、缺少 metadata 的 toolResult 不影响 invoked skill state。
- [x] 重复调用同一 skill 时保留最新记录。

**Verification:**
- [x] Tests pass: `bun test ./src/agent/session.test.ts`
- [x] 新测试覆盖成功记录、非 skill 不记录、失败不记录、重复覆盖。

**Dependencies:** Task 1

**Files likely touched:**
- `src/agent/types.ts`
- `src/agent/agent.ts`
- `src/agent/session.ts`
- `src/agent/session.test.ts`

**Estimated scope:** M

### Checkpoint: State Foundation

- [x] `bun test ./src/agent/tools/skill.test.ts ./src/agent/session.test.ts`
- [x] `invokedSkills` 不影响现有 `sentSkillNames` / `skill_listing` 去重行为。
- [x] 没有新增 session JSONL persistence 行为。

### Phase 2: Attachment Contract and Normalize

#### Task 3: 扩展 attachment 类型和 normalize contract

**Description:** 给 agent attachment union 增加 `invoked_skills`、`plan_file_reference`、`plan_mode`，并在 `normalizeAttachment()` 中把三类 attachment 转换为 `<system-reminder>` user message。此任务先让类型和 LLM payload contract 可用，不接 compact 生成。

**Acceptance criteria:**
- [x] `Attachment` union 包含三类新 attachment。
- [x] `normalizeAttachment()` 支持 `invoked_skills`，输出包含 skill name/path/content。
- [x] `normalizeAttachment()` 支持 `plan_file_reference` 和 `plan_mode`。
- [x] 现有 file/directory/skill_listing normalize 行为不变。

**Verification:**
- [x] Tests pass: `bun test ./src/agent/attachments/normalize.test.ts`
- [x] 新测试覆盖三类新 attachment 的 `<system-reminder>` 输出。
- [x] Type check validates exhaustive switch.

**Dependencies:** None

**Files likely touched:**
- `src/agent/attachments/types.ts`
- `src/agent/attachments/normalize.ts`
- `src/agent/attachments/normalize.test.ts`

**Estimated scope:** S

### Checkpoint: LLM Payload Contract

- [x] `bun test ./src/agent/attachments/normalize.test.ts`
- [x] `invoked_skills` normalized payload 可被 debug LLM View 后续识别为 attachment 来源。
- [x] 新 attachment 类型为 additive change，没有破坏旧测试。

### Phase 3: Restore Generators and Diagnostics

#### Task 4: 实现 invoked_skills restore generator

**Description:** 在 compact attachment 层实现 `createSkillRestoreAttachments()`，输入 invoked skill records，输出 `{ attachments, diagnostics }`。按 `invokedAt` 倒序排序，应用 per-skill 和 total bytes budget，超出时截断或跳过并记录 diagnostics。

**Acceptance criteria:**
- [x] 有 invoked skill records 时生成单个 `invoked_skills` attachment。
- [x] skills 按最近调用优先排序。
- [x] 超过 per-skill budget 时保留头部内容并追加 truncation marker。
- [x] 超过 total budget 的 skill 被跳过并写入 skip reason。
- [x] 无 invoked skills 时返回 `skipped: no invoked skills`。

**Verification:**
- [x] Tests pass: `bun test ./src/session/compact/attachments.test.ts`
- [x] 新测试覆盖生成、排序、截断、total budget、空状态。

**Dependencies:** Task 3

**Files likely touched:**
- `src/session/compact/attachments.ts`
- `src/session/compact/attachments.test.ts`

**Estimated scope:** M

#### Task 5: 为 plan/plan_mode restore 输出 unsupported diagnostics

**Description:** 在 compact attachment 层为 plan restore 和 plan mode restore 建立结构化结果。由于当前没有稳定 plan state，本阶段不生成 attachment，只返回明确 unsupported diagnostics。

**Acceptance criteria:**
- [ ] `createPlanRestoreAttachments()` 返回空 attachments 和 `plan restore unsupported: no stable plan state`。
- [ ] `createPlanModeRestoreAttachments()` 或等价函数返回空 attachments 和 `plan mode restore unsupported: no stable plan mode state`。
- [ ] 不读取 plan 文件，不新增 plan state。
- [ ] diagnostics reason 字符串稳定，可被测试断言。

**Verification:**
- [ ] Tests pass: `bun test ./src/session/compact/attachments.test.ts`
- [ ] 新测试覆盖 plan 和 plan_mode unsupported diagnostics。

**Dependencies:** Task 3

**Files likely touched:**
- `src/session/compact/attachments.ts`
- `src/session/compact/attachments.test.ts`

**Estimated scope:** S

### Checkpoint: Restore Sources

- [ ] `bun test ./src/session/compact/attachments.test.ts`
- [ ] `invoked_skills` 具备真实恢复能力。
- [ ] plan/plan_mode 不再静默空数组。
- [ ] 未触碰 background task/deferred tools/agent listing/MCP instructions。

### Phase 4: Compact Conversation Integration

#### Task 6: 聚合 attachment diagnostics 到 compact result 和 metadata

**Description:** 扩展 compact types，让 `CompactMetadata` / `CompactionResult` 能携带 `attachmentStats`。`compactConversation()` 需要聚合 file、skill、plan、plan_mode 的 restore 结果，把实际 attachments 放入 `postCompactMessages`，把 generated/skipped diagnostics 写入 boundary metadata。

**Acceptance criteria:**
- [ ] `CompactMetadata.attachmentStats` 或等价字段存在。
- [ ] `CompactionResult` 暴露 attachment diagnostics，供后续 debug API 使用。
- [ ] compact 成功且有 invoked skills 时，`result.attachments` 包含 `invoked_skills`。
- [ ] compact 成功但无 invoked skills 时，metadata 包含 skip reason。
- [ ] plan/plan_mode unsupported diagnostics 出现在 metadata。

**Verification:**
- [ ] Tests pass: `bun test ./src/session/compact/index.test.ts ./src/session/compact/messages.test.ts`
- [ ] 新测试覆盖有 invoked skills 和无 invoked skills 两条路径。
- [ ] 新测试断言 boundary metadata 包含 generated/skipped diagnostics。

**Dependencies:** Task 4, Task 5

**Files likely touched:**
- `src/session/compact/types.ts`
- `src/session/compact/messages.ts`
- `src/session/compact/conversation.ts`
- `src/session/compact/index.test.ts`
- `src/session/compact/messages.test.ts`

**Estimated scope:** M

#### Task 7: AgentSession.compact 传入 invokedSkills 并保留 active attachment

**Description:** 让 `AgentSession.compact()` 把 Agent state 中的 invoked skill records 传给 `compactConversation()`。成功 compact 后，active `session.messages` 中应包含 generated `invoked_skills` attachment；summary 失败和 messages changed 失败路径保持原子性。

**Acceptance criteria:**
- [ ] `AgentSession.compact()` 将 invoked skill state 传入 compactConversation。
- [ ] compact 成功后 active messages 包含 `role: "attachment"` 且 type 为 `invoked_skills`。
- [ ] `/compact` command stdout/message keep 行为不回归。
- [ ] summary 不合格时仍不替换 active messages。

**Verification:**
- [ ] Tests pass: `bun test ./src/agent/session.test.ts ./src/session/compact/index.test.ts`
- [ ] 新测试覆盖 SkillTool invoked state -> compact -> active attachment 的完整路径。

**Dependencies:** Task 2, Task 6

**Files likely touched:**
- `src/agent/session.ts`
- `src/agent/session.test.ts`
- `src/session/compact/conversation.ts`
- `src/session/compact/index.test.ts`

**Estimated scope:** M

### Checkpoint: End-to-End P0 Compact Path

- [ ] `bun test ./src/session/compact/attachments.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts ./src/agent/attachments/normalize.test.ts`
- [ ] 成功 compact 后 active messages 有 `invoked_skills` attachment。
- [ ] normalized LLM payload 包含 invoked skills `<system-reminder>`。
- [ ] 无 invoked skills、plan unsupported、plan mode unsupported 都有 diagnostics。

### Phase 5: Verification and Spec Alignment

#### Task 8: 回归测试和文档同步

**Description:** 运行聚焦测试和 typecheck，必要时更新 compact core plan 中 Phase 2/P0 的状态描述，确保新 spec 和既有 `compact-core-fix` plan 不冲突。

**Acceptance criteria:**
- [ ] 聚焦测试命令通过。
- [ ] `bun run typecheck` 通过。
- [ ] `git diff --check` 通过。
- [ ] 如果旧 plan 中 Phase 2 描述与本 P0 计划冲突，更新为引用本计划或标注拆分。

**Verification:**
- [ ] `bun test ./src/session/compact/attachments.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts ./src/agent/attachments/normalize.test.ts`
- [ ] `bun run typecheck`
- [ ] `git diff --check`

**Dependencies:** Task 7

**Files likely touched:**
- `docs/ys-powers/plans/2026-05-06-compact-core-fix.md`（仅当需要同步）
- `docs/ys-powers/specs/2026-05-06-compact-p0-attachment-alignment-design.md`（仅当实施发现 spec 需要更新）

**Estimated scope:** S

## Parallelization Opportunities

- Task 3 可以与 Task 1 并行：attachment union/normalize 不依赖 SkillTool metadata。
- Task 4 和 Task 5 可以并行：skill restore 与 plan unsupported diagnostics 互不依赖。
- Task 6 必须等待 Task 4/5 的结果结构稳定。
- Task 7 必须等待 Task 2 和 Task 6。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `PromptCommand` 没有真实文件路径 | Medium | 新增 optional `sourcePath`，无法填充时用空字符串并记录 `missing skill path` diagnostics |
| Tool output details 结构变化影响现有测试 | Medium | 只做 additive fields，保留现有 `details.success/skillName` |
| skill 内容过大导致 compact 后上下文膨胀 | High | per-skill 和 total bytes budget，超出截断或跳过 |
| plan contract 被误认为已实现 plan restore | Medium | diagnostics reason 明确 `unsupported: no stable plan state`，测试断言不生成 attachment |
| attachment metadata 与 session persistence 混淆 | Medium | 明确 attachment 不写入 JSONL，本阶段只验收 active messages/result/debug-ready metadata |

## Open Questions

- `sourcePath` 字段应在所有 PromptCommand loader 中填充，还是只在 `.claude/skills` loader 中填充。建议实施时先覆盖当前 SkillTool 实际读取的 `.claude/skills` 路径。
- `attachmentStats` 的 exact shape 是否复用 `CompactAttachmentDiagnostics`，还是增加更聚合的 `byType` 结构。建议先复用 spec 中的 `generated/skipped`，后续 Debug API 如需再派生。
