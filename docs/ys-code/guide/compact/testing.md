# Compact 测试覆盖地图

> 分析对象：`src/**/*compact*.test.ts`, `src/agent/session.test.ts`, `src/commands/index.test.ts`, `src/tui/command-utils.test.ts`, `src/session/session-*.test.ts` @ 73baf03
> 日期：2026-05-03

---

## 概述

compact 的测试分布在多个层级。维护时不要只跑 `src/session/compact/*.test.ts`，因为关键行为还覆盖 command dispatch、TUI、AgentSession、session persistence 和 restore。

---

## 推荐验证命令

针对 compact 的集中验证：

```bash
bun test \
  src/session/compact \
  src/agent/session.test.ts \
  src/commands/index.test.ts \
  src/tui/command-utils.test.ts \
  src/session/session-manager.test.ts \
  src/session/session-loader.test.ts \
  src/session/session-storage.test.ts
```

发布前完整验证：

```bash
bun test
bun run typecheck
```

---

## Command 与 TUI

| 行为 | 测试文件 |
|------|----------|
| `CommandResult` 支持 compact result | `src/commands/index.test.ts` |
| `/compact` 能被内置命令系统找到 | `src/commands/index.test.ts` |
| custom instructions 传入 compact service | `src/commands/index.test.ts` |
| local command call 失败返回 `skipPrompt` | `src/commands/index.test.ts` |
| local command load 失败返回 `skipPrompt` | `src/commands/index.test.ts` |
| user/project 级 compact 不能覆盖内置命令 | `src/commands/index.test.ts` |
| compact result 不调用 `session.prompt()` | `src/tui/command-utils.test.ts` |
| `skipPrompt` result 不调用 `session.prompt()` | `src/tui/command-utils.test.ts` |

---

## Message model

| 行为 | 测试文件 |
|------|----------|
| 创建 `compact_boundary` metadata | `src/session/compact/messages.test.ts` |
| 创建 summary meta message | `src/session/compact/messages.test.ts` |
| post-compact message ordering | `src/session/compact/messages.test.ts` |
| 只取最后一个 boundary 后的 messages | `src/session/compact/messages.test.ts` |
| LLM normalize 跳过 `compact_boundary` | `src/agent/attachments/normalize.test.ts` |

---

## Summary prompt

| 行为 | 测试文件 |
|------|----------|
| prompt 包含 no-tools preamble/trailer | `src/session/compact/prompt.test.ts` |
| prompt 包含 9 个 summary sections | `src/session/compact/prompt.test.ts` |
| custom instructions 进入 Additional Instructions | `src/session/compact/prompt.test.ts` |
| 移除 `<analysis>` 并提取 `<summary>` | `src/session/compact/prompt.test.ts` |
| plain text summary 自动加 `Summary:` | `src/session/compact/prompt.test.ts` |
| prompt 标记 tool/web/file 内容不可信 | `src/session/compact/prompt.test.ts` |
| bearer/env/private key redaction | `src/session/compact/prompt.test.ts` |
| bare provider token redaction | `src/session/compact/prompt.test.ts` |

---

## Microcompact

| 行为 | 测试文件 |
|------|----------|
| 清理旧 compactable tool results | `src/session/compact/microcompact.test.ts` |
| 保留最近 N 个 tool results | `src/session/compact/microcompact.test.ts` |
| 非 compactable tool result 不清理 | `src/session/compact/microcompact.test.ts` |
| 统计 `tokensSaved` 和 cleared/kept ids | `src/session/compact/microcompact.test.ts` |
| `keepRecent: 0` 不误保留全部结果 | `src/session/compact/microcompact.test.ts` |

---

## Attachment restore

| 行为 | 测试文件 |
|------|----------|
| 从缓存内容恢复最近读取文件 | `src/session/compact/attachments.test.ts` |
| partial read / offset / limit 跳过 | `src/session/compact/attachments.test.ts` |
| 单文件和总字节预算生效 | `src/session/compact/attachments.test.ts` |
| skipped candidates 不消耗 `maxFiles` | `src/session/compact/attachments.test.ts` |
| cwd 外路径跳过 | `src/session/compact/attachments.test.ts` |
| symlink 指向 workspace 外跳过 | `src/session/compact/attachments.test.ts` |
| `.env*`、`.ssh`、`.pem` 等敏感路径跳过 | `src/session/compact/attachments.test.ts` |
| 内容疑似包含 secret 时跳过 | `src/session/compact/attachments.test.ts` |

---

## compactConversation

| 行为 | 测试文件 |
|------|----------|
| summary 前执行 microcompact | `src/session/compact/index.test.ts` |
| 返回 boundary、summary、attachments 和 metrics | `src/session/compact/index.test.ts` |
| prompt-too-long 后截断重试 | `src/session/compact/index.test.ts` |
| summary failure 不产生 partial result | `src/session/compact/index.test.ts` |
| `postTokens` 写回 boundary metadata | `src/session/compact/index.test.ts` |

---

## AgentSession compact

| 行为 | 测试文件 |
|------|----------|
| compact 成功替换内存 messages | `src/agent/session.test.ts` |
| summary failure 不替换 messages | `src/agent/session.test.ts` |
| streaming 中拒绝 compact | `src/agent/session.test.ts` |
| duplicate compact 拒绝 | `src/agent/session.test.ts` |
| summary pending 期间 messages 变化则失败 | `src/agent/session.test.ts` |
| 默认 summary runner 调模型时禁用 tools | `src/agent/session.test.ts` |
| restoreSession 可恢复 compact 后 active context | `src/agent/session.test.ts` |

---

## Persistence 与 restore

| 行为 | 测试文件 |
|------|----------|
| `replaceMessages()` append-only，不删除旧 transcript | `src/session/session-manager.test.ts` |
| 多次 compact 从最新 structured boundary 恢复 | `src/session/session-manager.test.ts` |
| `SessionLoader` 从最新 boundary 后恢复 | `src/session/session-loader.test.ts` |
| session 目录和文件权限收紧 | `src/session/session-storage.test.ts` |
| 权限 drift 会被 append 后收紧 | `src/session/session-storage.test.ts` |
| corrupted line 被跳过且不记录原文 | `src/session/session-storage.test.ts` |

---

## 高价值后续测试

当前发布审查中识别出的后续增强方向：

- 断言 `postTokens` 经过 transcript 持久化和 restore 后仍保留。
- 对 corrupted transcript line 日志做更强断言，确保 payload 不含 secret 原文。
- 覆盖 compact 失败后再次 compact 可以成功。
- 覆盖 summary runner 只接收最新 `compact_boundary` 之后的消息。
- 增加恶意 WebFetch/file prompt injection 被 summary prompt 约束的回归测试。
