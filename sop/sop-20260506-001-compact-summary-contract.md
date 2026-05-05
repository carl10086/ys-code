---
title: "SOP: 修复 compact summary 不合格仍替换上下文"
created: 2026-05-06
tags: [bug-fix, other, 2026-05-06, compact, summary-contract]
project: ys-code
---

## 背景

在手动 `/compact` 的调试场景中，发现 compact summary 质量不稳定：模型可能返回缺少固定章节或过于简略的摘要，但系统仍会把 active `session.messages` 替换为 compact 后上下文，导致“compact 成功但上下文不可用”。同时 compact boundary metadata 与 session entry 类型契约没有记录 summary 校验结果，后续 debug/restore 难以判断 compact 是否健康。

## 解决方案

### 伪代码步骤

1. 定义 compact summary 的固定章节集合：
   - 使用 `COMPACT_SUMMARY_SECTIONS` 作为唯一来源
   - 要求 summary 必须包含 9 个固定 section heading

2. 格式化模型输出：
   - 移除 `<analysis>...</analysis>`
   - 优先提取 `<summary>...</summary>` 内容
   - 去除重复 `Summary:` 前缀
   - 执行 secret redaction
   - 返回统一 `Summary:\n...` 结构

3. 校验 formatted summary：
   - 对每个 required section 执行存在性检查
   - 收集 `missingSections`
   - 如果 `missingSections.length === 0`，返回 `{ ok: true, sectionCount, missingSections: [] }`
   - 否则返回 `{ ok: false, sectionCount, missingSections }`

4. 在 compact 主流程中接入校验：
   - 先运行 summary runner
   - 再调用 `formatCompactSummary(rawSummary)`
   - 再调用 `validateCompactSummary(summaryText)`
   - 如果 `summaryCheck.ok === false`，抛出包含缺失章节名的错误
   - 如果通过，创建 compact boundary 并写入 `compactMetadata.summaryCheck`

5. 在 AgentSession 层保持失败原子性：
   - compact 开始前记录当前 messages 快照
   - 调用 `compactConversation()`
   - 如果 summary 校验失败或 compact 期间 messages 变化，直接 reject
   - 只有 compact 成功且 messages 未变化时，才 replace active messages

6. 补齐类型和测试：
   - session entry 的 `compactMetadata` 复用 compact 层 `CompactMetadata`
   - 测试完整 summary、缺章节 summary、plain text summary
   - 测试缺章节错误包含具体 section
   - 测试失败时 `AgentSession` 不替换 messages
   - 测试成功 compact 后 active boundary 保留 `summaryCheck`

### 关键信息

- src/session/compact/prompt.ts
  - COMPACT_SUMMARY_SECTIONS
  - formatCompactSummary()
  - validateCompactSummary()
  - CompactSummaryValidation

- src/session/compact/conversation.ts
  - compactConversation()
  - runSummaryWithRetry()

- src/session/compact/messages.ts
  - createCompactBoundaryMessage()

- src/session/compact/types.ts
  - CompactMetadata
  - CompactBoundaryMessage
  - CompactionResult

- src/session/entry-types.ts
  - CompactBoundaryEntry

- src/agent/session.ts
  - AgentSession.compact()

- src/session/compact/prompt.test.ts
  - compact summary validation unit tests

- src/session/compact/index.test.ts
  - compactConversation summary validation and metadata tests

- src/agent/session.test.ts
  - AgentSession compact failure atomicity tests

### 关键命令

```bash
bun test ./src/session/compact/prompt.test.ts
bun test ./src/session/compact/index.test.ts ./src/agent/session.test.ts
bun test ./src/session/compact/prompt.test.ts ./src/session/compact/index.test.ts ./src/agent/session.test.ts
bun test ./src ./examples
bun run typecheck
git diff --check
git diff --check main
```

### 关键决策

- **summary 不合格直接失败，而不是降级成功**：compact 的目标是保留可继续工作的上下文；低质量 summary 比不 compact 更危险，因此失败时必须保留原 messages。

- **先 redaction 再 validation / metadata**：formatted summary 会被持久化并进入 active context，必须先移除 secrets；metadata 只记录固定章节名和统计值，不写入 summary 正文。

- **`COMPACT_SUMMARY_SECTIONS` 作为单一契约来源**：prompt、validation、tests 都引用同一组 section，避免 prompt 和 checker 漂移。

- **失败路径不触发 `replaceMessages()`**：`AgentSession.compact()` 只有在 compact result 完整且 messages 未变化时才替换 active context，保证失败原子性。

- **metadata 类型在 compact 层和 session entry 层共享**：`CompactBoundaryEntry.compactMetadata` 复用 `CompactMetadata`，避免 debug/restore 后续读取 `summaryCheck` 时类型契约不一致。

- **本阶段只解决 summary contract，不混入 attachment/debug 后续阶段**：attachment diagnostics、debug UI、命令错误文案属于 Phase 2+，避免扩大当前修复范围。
