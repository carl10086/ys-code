# Spec: Compact Core Fix

## Objective

本期修复手动 `/compact` 的三个高优问题：

1. `/compact` 并发触发时不能只显示泛化的 `Command failed. See logs for details.`
2. compact 成功后，active `session.messages` 中必须能保留用于继续工作的 post-compact attachments，并能在 `/debug` 中观察到。
3. compact summary 必须稳定保留最近事实和继续工作所需上下文，不能退化成一句泛化描述。

目标用户是开发和调试 `ys-code` 的工程师。成功标准不是 `/sessions` 可见，而是手动 `/compact` 后：

- `/debug` 的 Messages 能看到 active context 中的 compact summary 与 generated attachments。
- `/debug` 的 LLM View 能看到 attachments 被 normalize 成 `<system-reminder>`，并标记为 attachment 来源。
- 下一轮模型实际收到的 payload 包含 summary 和可恢复上下文。

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- UI: Ink + React
- Web Debug: 内置 HTTP server + `/debug` 静态页面 + `/api/debug/context`
- Tests: `bun test`

本期不引入新模型 provider，不引入新外部依赖。

## Commands

```bash
# 运行 compact 相关单测
bun test ./src/session/compact/*.test.ts ./src/agent/session.test.ts

# 运行 debug API 相关测试
bun test ./src/web/debug/debug-api.test.ts ./src/web/debug-inspector-e2e.test.ts

# 运行 debug compact 示例测试
bun test ./examples/debug-compact.test.ts

# 完整测试
bun test

# 类型检查（如 package scripts 存在）
bun run typecheck
```

## Project Structure

```text
src/commands/compact/
  compact.ts
    手动 /compact 命令入口。负责把用户指令传给 AgentSession.compact()。

src/agent/
  session.ts
    手动 compact 的运行入口。负责并发保护、summary runner、active messages replacement。

src/session/compact/
  conversation.ts
    compact 主流程：active messages 截取、microcompact、summary、boundary、attachments、metrics。
  prompt.ts
    compact summary prompt 和 summary format/check 逻辑。
  attachments.ts
    post-compact restore attachments：file、skill、plan，以及 skip reason。
  messages.ts
    compact_boundary、summary message、post-compact message ordering。
  *.test.ts
    compact 单元测试。

src/web/debug/
  debug-api.ts
    debug context API。必须暴露 active messages、LLM payload、compact diagnostics。
  debug.html.ts
    Debug Inspector 页面。展示 attachment 来源和 compact diagnostics。

examples/
  debug-compact.ts
  debug-compact.test.ts
    端到端复现和验证手动 compact 的 debug 输出。
```

`/sessions` 和 session viewer 不在本期范围内。attachment 不要求写入 session JSONL。

## Code Style

优先沿用现有 TypeScript 风格：小函数、显式类型、纯函数优先、错误信息面向开发者可诊断。

示例：attachment 生成结果应同时携带生成项和跳过原因，避免 debug 时只能看到空数组。

```ts
export interface CompactAttachmentDiagnostics {
  generated: Array<{ type: string; displayName: string }>;
  skipped: Array<{ type: string; reason: string }>;
}

export interface PostCompactAttachmentResult {
  attachments: AgentMessage[];
  diagnostics: CompactAttachmentDiagnostics;
}
```

错误信息应保留根因，例如：

```ts
if (this.compactInProgress) {
  throw new Error("Compact is already in progress");
}
```

命令层可以把已知错误转成用户可读文案，但不能吞掉根因日志。

## Design

### Scope

本期只处理手动 `/compact`：

```text
/compact
  -> src/commands/compact/compact.ts
  -> AgentSession.compact()
  -> compactConversation()
  -> agent.replaceMessages(postCompactMessages)
  -> /api/debug/context observes active session.messages
```

不改：

- `SessionManager.compactIfNeeded()` 的 auto compact 触发机制
- reactive compact
- session memory compact
- `/sessions` 和 session viewer

### Summary Generation

`compact` summary 必须接近 CC 的行为：

- prompt 明确要求 no tools。
- prompt 要求先输出 `<analysis>`，再输出 `<summary>`。
- final summary 必须包含 9 个固定章节。
- `formatCompactSummary()` 去掉 `<analysis>`，保留 `Summary:\n...`。
- summary checker 验证 9 个章节是否存在。

如果 summary 结构不合格，本期视为 compact 失败，而不是 warning。这样避免“compact 成功但上下文不可用”的假阳性。

### Post-Compact Attachments

本期实现或补齐以下 active context attachments：

- 最近完整读取过的 file restore attachment。
- 已调用 skill 的 restore attachment。
- plan / plan mode restore attachment。

如果某类 attachment 无可恢复状态，必须返回 skip reason，例如：

- `no fileStateCache entries`
- `all files skipped by size/security/secret rules`
- `no invoked skills`
- `no active plan`

attachment 不写入 session JSONL，但必须进入 `agent.replaceMessages(postCompactMessages)` 后的 active `session.messages`。

### Debug Diagnostics

`/api/debug/context` 应暴露 compact 诊断信息：

- active messages 中 attachment 数量和类型。
- compact boundary metadata 中的 token、summary check、attachment stats。
- normalized LLM payload 中哪些消息来自 attachment。
- attachment 为空时的 skip reason。

Debug Inspector 页面至少要能通过 Messages / LLM View 判断：

- attachment 是否在 active context 中。
- attachment 是否进入实际 LLM payload。
- 没生成 attachment 的具体原因。

### Concurrent Compact

保留 `AgentSession.compact()` 的 `compactInProgress` guard。

命令层对已知 compact 错误做明确提示：

- `Compact is already in progress` → 提示 compact 正在进行中，等待完成后重试。
- `Cannot compact while a model response is streaming` → 提示当前模型仍在响应，等待结束后重试。
- 其他未知错误继续记录日志，并显示通用失败提示。

## Testing Strategy

### Unit Tests

- `prompt.test.ts`
  - compact prompt 包含 no-tools、`<analysis>`、`<summary>`、9 个章节要求。
  - `formatCompactSummary()` 去掉 analysis 并输出 `Summary:\n...`。
  - summary checker 缺章节时失败。

- `conversation.test.ts` 或 `index.test.ts`
  - summary 缺章节时 `compactConversation()` 失败。
  - summary 合格时返回 `boundary + summary + keep + attachments`。
  - `compactMetadata` 包含 summary check 和 attachment diagnostics。

- `attachments.test.ts`
  - file restore 成功。
  - 没有 file cache 时返回 skip reason。
  - partial read、过大文件、敏感路径、secret content 被跳过并记录 reason。
  - skill restore 和 plan restore 在有状态时生成 attachment，无状态时记录 skip reason。

- `agent/session.test.ts`
  - 并发 `/compact` 返回明确错误。
  - compact 成功后 active messages 包含 attachments。
  - session persistence 不作为本期断言重点。

### Debug Tests

- `debug-api.test.ts`
  - `/api/debug/context` 返回 active attachment count/type。
  - LLM View 中 attachment normalize 为 `<system-reminder>`。
  - `_debug.source === "attachment"` 可识别。
  - compact diagnostics 中包含 generated/skipped/reasons。

### Example / E2E

- `examples/debug-compact.test.ts`
  - 模拟 Read 后执行 `/compact`，验证 debug context 可见 file attachment。
  - 验证 summary 包含 9 个章节。
  - 模拟无可恢复 attachment，验证 debug context 明确显示 skip reason。

## Boundaries

### Always

- 手动 `/compact` 的 active context 必须通过 `/debug` 可验证。
- summary 不合格必须失败，不能替换掉原 messages。
- attachments 为空时必须有 skip reason。
- 保持 attachment 不持久化到 session JSONL 的现有边界。
- 测试先覆盖失败复现，再做实现。

### Ask First

- 改 `/sessions` 或 session JSONL 持久化格式。
- 引入新依赖。
- 引入新的 model provider 或改模型选择策略。
- 扩展到 auto compact、reactive compact、session memory compact。
- 大幅重构 `AgentSession` 或 `SessionManager` 边界。

### Never

- 不为了让测试通过而降低 summary 结构要求。
- 不吞掉 compact 错误根因。
- 不把 secrets、private key、token 注入 post-compact attachment。
- 不读取或持久化超出当前 workspace 安全边界的文件。
- 不在本期修改 `refer/claude-code-haha`。

## Success Criteria

- 重复触发 `/compact` 时，用户看到明确的“compact 正在进行中”提示，而不是泛化失败。
- 手动 `/compact` 成功后，`/api/debug/context.messages` 中能看到 generated attachments，或看到明确 skip reasons。
- `/api/debug/context.llmMessages` 中能看到 attachment normalize 后的 `<system-reminder>`，并带 `_debug.source === "attachment"`。
- compact summary 包含 9 个固定章节；缺章节时 compact 失败且不替换 active messages。
- `compactMetadata` 或 debug diagnostics 能显示 summary check、attachment stats、token metrics。
- `bun test ./src/session/compact/*.test.ts ./src/agent/session.test.ts ./src/web/debug/debug-api.test.ts ./examples/debug-compact.test.ts` 通过。

## Open Questions

- skill restore 的状态来源是否直接使用 `sentSkillNames`，还是需要记录被调用 skill 的完整内容？
- plan / plan mode 的当前状态在 YS 中是否已有稳定来源？如果没有，本期是否只做 skip reason？
- background task attachment 是否本期完全排除，还是在 diagnostics 中预留类型并标记 unsupported？

