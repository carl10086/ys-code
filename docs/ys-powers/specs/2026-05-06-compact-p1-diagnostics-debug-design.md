# Spec: Compact P1 Diagnostics and Debug Alignment

## Objective

本 spec 定义手动 `/compact` 的 P1 对齐范围，目标是在 P0 attachment alignment 已完成的基础上，补齐 file restore diagnostics、命令层错误映射、debug observability，让 compact 行为在开发和运行时完全可诊断。

目标用户是开发和调试 `ys-code` compact 能力的工程师。成功标准是：

- File restore 被跳过时，compact metadata 和 debug API 能显示明确 skip reason（partial view、workspace 外、敏感路径、secret、size budget）。
- 重复 `/compact` 或 streaming 中 `/compact` 时，用户看到明确的操作提示，而不是泛化的 `Command failed`。
- `/api/debug/context` 暴露 compact diagnostics：attachment count/type、summary check、skip reasons。
- Debug Inspector 页面能直接查看 compact diagnostics，无需手动翻 messages。
- Debug-compact 示例验证端到端的 summary + attachment + diagnostics 路径。

不扩大到 auto-compact、reactive compact、session memory compact、background task、deferred tools、agent listing、MCP instructions。

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Test framework: `bun test`
- TUI / command layer: Ink + local slash command
- Compact core: `src/session/compact/*`
- Debug: `src/web/debug/*`

本阶段不新增外部依赖。

## Commands

```bash
# file restore diagnostics + attachment tests
bun test ./src/session/compact/attachments.test.ts

# compact integration tests
bun test ./src/session/compact/index.test.ts ./src/agent/session.test.ts

# command error mapping tests
bun test ./src/commands/index.test.ts

# debug API tests
bun test ./src/web/debug/debug-api.test.ts

# debug inspector e2e tests
bun test ./src/web/debug-inspector-e2e.test.ts

# debug compact example
bun test ./examples/debug-compact.test.ts

# 完整 P1 验证
bun test ./src/session/compact/attachments.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts ./src/commands/index.test.ts ./src/web/debug/debug-api.test.ts ./src/web/debug-inspector-e2e.test.ts ./examples/debug-compact.test.ts

# type check
bun run typecheck
```

## Project Structure

```text
src/session/compact/
  attachments.ts
    createPostCompactFileAttachments() 返回 { attachments, diagnostics }
    diagnostics 包含 generated/skipped，skip reason 明确到具体规则。
  conversation.ts
    聚合 file/skill/plan diagnostics，写入 CompactionResult 与 boundary metadata。
  types.ts
    CompactAttachmentDiagnostics、PostCompactAttachmentResult 类型（P0 已引入，P1 补全 file diagnostics）。

src/commands/
  index.ts 或 compact/compact.ts
    映射已知 compact 错误到用户可读提示。

src/web/debug/
  debug-api.ts
    DebugContextResponse 扩展 compactDiagnostics 字段。
  debug.html.ts
    Debug Inspector 页面增加 compact diagnostics 展示区。

examples/
  debug-compact.ts
  debug-compact.test.ts
    端到端示例覆盖 file attachment + diagnostics + summary check。
```

## Code Style

沿用 P0 已建立的 additive change 风格：

- `createPostCompactFileAttachments()` 从返回 `AttachmentMessage[]` 改为返回 `PostCompactAttachmentResult`，调用方同步更新。
- diagnostics reason 使用稳定字符串，便于测试断言和 debug UI 消费。
- 命令层错误映射保留原始错误日志，只转换面向用户的文案。

```ts
export interface PostCompactAttachmentResult {
  attachments: AgentMessage[];
  diagnostics: CompactAttachmentDiagnostics;
}
```

错误映射示例：

```ts
if (error.message.includes("Compact is already in progress")) {
  return { type: "text", text: "Compact 正在进行中，请等待完成后重试。" };
}
```

## Design

### File Restore Diagnostics

`createPostCompactFileAttachments()` 当前只返回 `AttachmentMessage[]`，被跳过的文件没有任何痕迹。P1 改为返回 `{ attachments, diagnostics }`，每条 skip reason 精确到触发规则：

- `entry is partial view`：FileStateCache entry 有 offset/limit。
- `entry outside workspace`：realpath 不在 cwd 内。
- `sensitive path`：路径匹配 `.ssh`、`.env`、`.pem` 等规则。
- `not a file`：stat 结果不是 regular file。
- `contains secret`：内容通过 `containsSecret()` 检测。
- `exceeds max bytes per file`：单文件超过 `maxBytesPerFile`。
- `exceeds total bytes budget`：累计超过 `maxTotalBytes`。
- `no fileStateCache entries`：snapshot 为空。
- `max files reached`：超过 `maxFiles` 限制。

生成的 attachment 记录在 `generated` 数组中，包含 `type: "file"` 和 `displayPath`。

### Command Error Mapping

`AgentSession.compact()` 抛出两个已知错误：

- `Cannot compact while a model response is streaming`
- `Compact is already in progress`

命令层捕获这两个错误并转换为中文用户提示，其他错误继续显示通用失败文案并记录日志根因。

### Debug API Compact Diagnostics

`/api/debug/context` 返回增加 `compactDiagnostics` 字段：

```ts
interface CompactDiagnostics {
  summaryCheck?: { ok: boolean; sectionCount: number; missingSections?: string[] };
  attachmentStats?: CompactAttachmentDiagnostics;
  tokenMetrics?: { preCompactTokens: number; postCompactTokens?: number; microcompactTokensSaved: number };
}
```

数据来源于 `session.messages` 中最近的 `compact_boundary` 的 `compactMetadata`。如果没有 compact boundary，返回空结构。

### Debug Inspector Compact Diagnostics

在 `/debug` 页面增加一个轻量 diagnostics 卡片：

- 最新 compact 的 token 变化（pre -> post）。
- Summary check 结果（章节数、是否通过）。
- Attachment generated count / skipped count。
- Skip reasons 列表（可展开）。

## Testing Strategy

### Unit Tests

- `src/session/compact/attachments.test.ts`
  - partial view entry 返回 `skipped: entry is partial view`。
  - workspace 外路径返回 `skipped: entry outside workspace`。
  - 敏感路径返回 `skipped: sensitive path`。
  - secret content 返回 `skipped: contains secret`。
  - 超大文件返回 `skipped: exceeds max bytes per file`。
  - total budget 超限返回 `skipped: exceeds total bytes budget`。
  - 空 fileStateCache 返回 `skipped: no fileStateCache entries`。
  - 成功生成的文件记录在 `generated` 中，包含 `type: "file"`。

- `src/commands/index.test.ts` 或 `src/commands/compact/compact.test.ts`
  - `Compact is already in progress` 映射为明确中文提示。
  - streaming 错误映射为明确中文提示。
  - 未知错误保持通用失败提示。

- `src/web/debug/debug-api.test.ts`
  - `/api/debug/context` 返回 `compactDiagnostics`。
  - 有 compact boundary 时返回 summaryCheck、attachmentStats、tokenMetrics。
  - 无 compact boundary 时返回空结构或 omit。

### E2E Tests

- `src/web/debug-inspector-e2e.test.ts`
  - `/debug` 页面包含 compact diagnostics 区域。
  - skip reasons 可展开查看。

- `examples/debug-compact.test.ts`
  - 模拟 Read 后执行 `/compact`，验证 debug context 可见 file attachment 和 diagnostics。
  - 验证 summary 包含 9 个章节。
  - 模拟无可恢复 attachment，验证 debug context 明确显示 skip reason。

### Regression Tests

- 现有 file attachment 生成行为不变（同样的过滤逻辑，只是增加 diagnostics）。
- P0 的 invoked_skills restore 行为不回归。
- summary 不合格时仍不替换 active messages。

## Boundaries

### Always

- Always 让 file restore skip 有明确 reason。
- Always 保留原始错误日志，命令层只转换用户文案。
- Always 从 `session.messages` 中的最新 compact boundary 提取 diagnostics，不新增持久化。
- Always 保持 P0 的 invoked_skills、plan unsupported diagnostics 不变。

### Ask First

- Ask first before adding background task diagnostics。
- Ask first before writing attachments to session JSONL。
- Ask first before adding external dependencies。
- Ask first before expanding to auto compact / reactive compact / session memory compact。

### Never

- Never silently return empty restore arrays。
- Never swallow compact error root cause。
- Never include secrets in debug diagnostics（只暴露 skip reason，不暴露被过滤的内容）。
- Never modify `refer/claude-code-haha`。

## Success Criteria

- `bun test ./src/session/compact/attachments.test.ts` 通过，覆盖所有 file skip reason。
- `bun test ./src/commands/index.test.ts` 通过，覆盖两个已知 compact 错误映射。
- `bun test ./src/web/debug/debug-api.test.ts` 通过，`/api/debug/context` 返回 compactDiagnostics。
- `/debug` 页面可查看 compact diagnostics 卡片。
- `bun test ./examples/debug-compact.test.ts` 通过，端到端覆盖 summary + attachment + diagnostics。
- `bun run typecheck` 通过。
