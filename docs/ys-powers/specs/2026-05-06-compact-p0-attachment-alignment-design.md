# Spec: Compact P0 Attachment Alignment

## Objective

本 spec 设计手动 `/compact` 的 P0 attachment 对齐方案，目标是把 `ys-code` 的 compact restore 行为向 Claude Code 的关键能力靠拢：compact 成功后，模型仍能获得继续工作必需的 skill 上下文，并且 plan 相关缺口不再静默失败。

目标用户是开发和调试 `ys-code` compact 能力的工程师。成功标准是：

- 已调用过的 skill 内容能在 compact 后作为 `invoked_skills` attachment 进入 active `session.messages`。
- `invoked_skills` 能被 `normalizeMessages()` 转换为 `<system-reminder>`，实际进入下一轮 LLM payload。
- `plan_file_reference` 和 `plan_mode` 先建立 attachment contract；由于当前没有稳定 plan state，本阶段必须输出明确 diagnostics，而不是静默空数组。
- 不扩大到 background task、deferred tools、agent listing、MCP instructions 等 P1/P2 范围。

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Test framework: `bun test`
- TUI / command layer: Ink + local slash command
- Compact core: `src/session/compact/*`
- Agent state: `src/agent/*`

本阶段不新增外部依赖。

## Commands

```bash
# attachment contract and restore unit tests
bun test ./src/session/compact/attachments.test.ts

# compact integration tests
bun test ./src/session/compact/index.test.ts ./src/agent/session.test.ts

# attachment normalize tests
bun test ./src/agent/attachments/normalize.test.ts ./src/agent/stream-assistant.test.ts

# focused verification for the P0 compact path
bun test ./src/session/compact/attachments.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts ./src/agent/attachments/normalize.test.ts

# type check
bun run typecheck
```

## Project Structure

```text
src/agent/
  types.ts
    增加 invoked skill state 的类型字段。
  session.ts
    SkillTool 执行后的 state 由 AgentSession/Agent state 持有；compact 时传入 compactConversation。
  tools/skill.ts
    SkillTool 成功执行后返回可记录的 skill restore metadata。

src/agent/attachments/
  types.ts
    扩展 Attachment union：invoked_skills、plan_file_reference、plan_mode。
  normalize.ts
    把新 attachment 类型转换为 <system-reminder>。

src/session/compact/
  attachments.ts
    生成 invoked_skills restore attachment；为 plan/plan_mode 输出 unsupported diagnostics。
  types.ts
    增加 attachment diagnostics / stats 类型，并接入 CompactMetadata。
  conversation.ts
    聚合 restore attachments 和 diagnostics，写入 CompactionResult 与 compact boundary metadata。
  *.test.ts
    覆盖 P0 restore、unsupported diagnostics、metadata。
```

## Code Style

使用 discriminated union 明确每类 attachment 的契约，新增字段走 additive change，不改变现有 `file | directory | skill_listing` 行为。

```ts
export interface InvokedSkillRecord {
  name: string;
  path: string;
  content: string;
  invokedAt: number;
}

export interface InvokedSkillsAttachment extends BaseAttachment {
  type: "invoked_skills";
  skills: Array<{
    name: string;
    path: string;
    content: string;
  }>;
}

export interface CompactAttachmentDiagnostics {
  generated: Array<{
    type: string;
    displayName?: string;
    count?: number;
  }>;
  skipped: Array<{
    type: string;
    reason: string;
  }>;
}
```

diagnostics 使用稳定 reason 字符串，便于测试和 debug UI 后续消费。内部生成函数优先返回结构化结果：

```ts
export interface PostCompactAttachmentResult {
  attachments: AgentMessage[];
  diagnostics: CompactAttachmentDiagnostics;
}
```

## Design

### CC Alignment Scope

Claude Code 的 P0 行为中，compact 后会恢复被 summary 替换掉的关键上下文。其中对本阶段最重要的是：

- `invoked_skills`: 保存已调用 skill 的完整内容，让模型 compact 后继续遵守 skill 指南。
- `plan_file_reference`: 如果有 plan 文件，compact 后提示模型继续参考。
- `plan_mode`: 如果 compact 前处于 plan mode，compact 后继续提醒模型遵守 plan mode。

`ys-code` 当前只有 `skill_listing` 和 `sentSkillNames`，没有记录“已调用 skill 的内容”；也没有稳定 plan state。因此本阶段采取最小真实对齐：

- `invoked_skills` 真实实现。
- `plan_file_reference` 和 `plan_mode` 只定义 contract + unsupported diagnostics。
- background `task_status`、deferred tools、agent listing、MCP instructions 不进入本 spec。

### Invoked Skill State

新增 `InvokedSkillRecord`，保存字段：

- `name`: skill 名称。
- `path`: skill 来源路径；如果当前 `PromptCommand` 没有显式路径，使用 command metadata 中可获得的最稳定标识，无法获得时记录空字符串并在 diagnostics 中标记 `missing skill path`。
- `content`: `getPromptForCommand()` 返回的文本内容。
- `invokedAt`: 成功执行时间戳。

状态存放在 agent state，而不是 session JSONL。原因：

- CC 的 invoked skill restore 是 compact 后 active context 能力，不要求 session persistence 作为本阶段验收目标。
- 当前项目已有 `sentSkillNames` 存在于 agent state，新增 `invokedSkills` 与现有边界一致。
- attachment 本身仍不写入 session JSONL，保持既有 compact 设计。

`SkillTool.execute()` 成功获取 skill 内容后，除了返回 meta user message，还需要让 AgentSession 能记录 invoked skill。推荐通过 tool output 的 `details` 增加可选 metadata，而不是让 tool 直接写外部状态：

```ts
details: {
  success: true,
  skillName: params.skill,
  skillPath: command.sourcePath ?? "",
  skillContent: textContent,
  invokedAt: Date.now(),
}
```

实际字段名以现有 `PromptCommand` 类型可提供的信息为准；如果 `PromptCommand` 没有 path，需要在 spec 实施计划中先补一个可选 `sourcePath` 或等价字段。

### Restore Generation

`createSkillRestoreAttachments()` 接收 invoked skill records，按 `invokedAt` 倒序排列，并生成一个 `invoked_skills` attachment。内容预算对齐 CC 的思路：保留每个 skill 文件头部，超出时截断并加 marker。

建议预算：

- `POST_COMPACT_MAX_BYTES_PER_SKILL = 20_000`
- `POST_COMPACT_SKILLS_MAX_TOTAL_BYTES = 100_000`

预算使用 bytes 而不是 token，保持 YS 当前 compact attachment budget 的实现风格；如果后续统一 token estimator，可在 P1 调整。

无 invoked skills 时不生成 attachment，diagnostics 记录：

```text
skipped: no invoked skills
```

所有 skill 因预算被跳过时记录：

```text
skipped: invoked skills exceeded restore budget
```

### Plan Contracts

新增 attachment 类型，但本阶段不新增 plan state：

```ts
export interface PlanFileReferenceAttachment extends BaseAttachment {
  type: "plan_file_reference";
  planFilePath: string;
  planContent: string;
}

export interface PlanModeAttachment extends BaseAttachment {
  type: "plan_mode";
  reminderType: "full";
  planFilePath?: string;
  planExists: boolean;
}
```

由于当前搜索没有发现稳定的 `plan`/`plan_mode` 状态来源，本阶段的 `createPlanRestoreAttachments()` 应返回空 attachments 和明确 diagnostics：

```text
skipped: plan restore unsupported: no stable plan state
skipped: plan mode restore unsupported: no stable plan mode state
```

这样后续实现 plan system 时可以直接复用 attachment contract 和 normalize contract，不需要再次改 compact result 结构。

### Normalize Behavior

`normalizeAttachment()` 必须新增三个 case：

- `invoked_skills`: 生成一个 meta user `<system-reminder>`，内容包含每个 skill 的 name、path、content。
- `plan_file_reference`: 生成一个 meta user `<system-reminder>`，内容提示 plan 文件路径和内容。
- `plan_mode`: 生成一个 meta user `<system-reminder>`，内容提示当前仍应遵守 plan mode；如果 `planExists` 为 false，提示没有可用 plan 文件。

`invoked_skills` 的输出接近 CC：

```text
<system-reminder>
The following skills were invoked in this session. Continue to follow these guidelines:

### Skill: cc-diff
Path: .claude/skills/cc-diff/SKILL.md

...
</system-reminder>
```

### Compact Metadata

`CompactMetadata` 增加可选字段：

```ts
attachmentStats?: CompactAttachmentDiagnostics;
```

`compactConversation()` 负责聚合：

- file restore result diagnostics
- invoked skill restore diagnostics
- plan restore unsupported diagnostics
- plan mode unsupported diagnostics

`CompactionResult.attachments` 仍然只包含实际生成的 active context attachments；diagnostics 写入 `boundaryMessage.compactMetadata.attachmentStats`，并可选在 result 上暴露同一份结构，供 Debug API 后续消费。

## Testing Strategy

### Unit Tests

- `src/session/compact/attachments.test.ts`
  - 有 invoked skill records 时生成 `invoked_skills` attachment。
  - records 按 `invokedAt` 倒序输出。
  - skill 内容超出 per-skill budget 时截断并保留 marker。
  - 无 invoked skills 时返回 `skipped: no invoked skills`。
  - plan restore 返回 `unsupported: no stable plan state`。
  - plan mode restore 返回 `unsupported: no stable plan mode state`。

- `src/agent/attachments/normalize.test.ts`
  - `invoked_skills` normalize 为 `<system-reminder>`。
  - normalized 内容包含 skill name/path/content。
  - `plan_file_reference` 和 `plan_mode` normalize contract 可用。

- `src/agent/session.test.ts`
  - SkillTool 成功执行后，AgentSession 或 Agent state 记录 invoked skill。
  - compact 时传入 invoked skill state。
  - compact 成功后 active messages 包含 `role: "attachment"` 且 type 为 `invoked_skills`。

### Integration Tests

- `src/session/compact/index.test.ts`
  - `compactConversation()` 返回 `attachments` 包含 `invoked_skills`。
  - `boundaryMessage.compactMetadata.attachmentStats` 同时记录 generated 和 skipped。
  - 没有 invoked skills 时不生成 attachment，但 metadata 有 skip reason。

### Regression Tests

- 现有 file restore 行为不回归。
- summary validation 失败时仍不替换 active messages。
- attachment 不写入 session JSONL 的当前策略不变。

## Boundaries

### Always

- Always 保持 summary contract：summary 不合格时 compact 失败，不替换 messages。
- Always 让 generated attachment 进入 active `session.messages` 和 normalized LLM payload。
- Always 为未生成的 P0 restore 来源写 diagnostics。
- Always 使用 additive type changes，避免破坏现有 attachment 消费方。
- Always 对 skill 内容做预算限制，避免 compact 后上下文膨胀。

### Ask First

- Ask first before introducing persistent plan state.
- Ask first before writing attachments to session JSONL.
- Ask first before adding external dependencies.
- Ask first before expanding scope to background task、deferred tools、agent listing、MCP instructions。

### Never

- Never silently return empty restore arrays for P0 sources.
- Never include secrets if future skill content source is not trusted; keep existing secret filtering policy available for file restore, and do not add broad secret logging.
- Never remove existing `skill_listing` behavior as part of this change.
- Never weaken `compactInProgress` or streaming compact guards.

## Success Criteria

- `invoked_skills` is generated after at least one successful `SkillTool` invocation and a successful manual compact.
- `normalizeMessages()` emits `<system-reminder>` content for `invoked_skills`.
- `CompactMetadata.attachmentStats` records generated `invoked_skills`.
- With no invoked skills, compact succeeds and records `skipped: no invoked skills`.
- Plan and plan mode restore are visible as unsupported diagnostics, not silent empty arrays.
- The focused test command passes:

```bash
bun test ./src/session/compact/attachments.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts ./src/agent/attachments/normalize.test.ts
```

## Open Questions

- `PromptCommand` 当前是否已有稳定 source path 字段。如果没有，实施计划需要先新增 optional source path，或者定义 fallback path 策略。
- `SkillTool.execute()` 的 tool output metadata 由哪个层消费最合适：tool execution layer、AgentSession event handler，还是 Agent state reducer。
- P1 是否继续补 `task_status` background restore，还是先进入 Debug API/UI 观测阶段。
