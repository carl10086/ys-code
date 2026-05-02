# Compact 安全与失败模式

> 分析对象：`src/agent/session.ts`, `src/commands/index.ts`, `src/session/compact/*`, `src/session/session-storage.ts` @ 73baf03
> 日期：2026-05-03

---

## 概述

compact 的核心安全目标是：**成功时完整接管 active context，失败时完全不改变 active context**。

这要求 compact 在命令调度、summary 生成、message 替换、持久化、安全过滤等多个位置都保持明确边界。

---

## 原子性

`AgentSession.compact()` 只在 `compactConversation()` 成功返回、且消息快照未变化时替换 messages。

失败路径包括：

- summary runner 抛错。
- prompt-too-long 重试仍失败。
- compact 期间有 late message 追加。
- 正在 streaming。
- 已有 compact 正在执行。

这些失败都不会调用：

```text
SessionManager.replaceMessages()
Agent.replaceMessages()
```

---

## streaming guard

如果模型正在流式输出，`AgentSession.compact()` 会拒绝：

```text
Cannot compact while a model response is streaming
```

原因是 streaming 期间 assistant message、tool call 或 tool result 可能还在追加。此时 compact 会产生不完整或过期的 summary。

---

## duplicate compact guard

`compactInProgress` 防止同一 session 同时执行多个 compact。

```text
if compactInProgress:
    throw "Compact is already in progress"
```

`finally` 会重置该标志，避免失败后无法再次 compact。

---

## late message guard

compact 开始时记录：

```text
messagesAtStart = this.agent.state.messages
messageSnapshot = messagesAtStart.slice()
```

summary 生成完成后检查：

- messages 数组引用是否仍相同。
- messages 长度是否仍相同。
- 每个位置的 message 对象引用是否仍相同。

只要不一致，就抛出：

```text
Messages changed during compact; retry /compact.
```

这样可以避免 compact 期间产生的新消息被 `replaceMessages()` 覆盖丢失。

---

## local command 失败不回退 prompt

`executeCommand()` 对 local command 的 catch 分支返回：

```text
handled: true
skipPrompt: true
textResult: "Command failed. See logs for details."
```

这保证 `/compact` 失败时不会被当成普通 prompt 发送给主模型。

详细错误写入 logger，但 UI 只展示泛化错误。

---

## reserved builtin command

`compact` 是 reserved builtin command：

```text
RESERVED_BUILTIN_COMMAND_NAMES = new Set(["compact"])
```

skills、user commands、project commands 都不能覆盖 `/compact`。

这避免外部同名命令把 `/compact` 变成 prompt command 或其他不安全行为。

---

## secret redaction

`formatCompactSummary()` 会在 summary 持久化前调用 `redactSecrets()`。

当前覆盖：

- PEM private key block
- `Authorization: Bearer ...`
- env-style key-value
- token / secret / password / api key 类 key-value
- 常见 provider token，如 `sk-...`、`ghp_...`、`github_pat_...`、`xoxb-...`、`npm_...`、`AKIA...`

`containsSecret()` 复用同一套 redaction 逻辑，用于 attachment content 检测。

---

## attachment 安全边界

post-compact attachment restore 具备多层过滤：

```text
partial read skip
cwd realpath containment
symlink escape skip
sensitive path skip
non-file skip
content secret skip
single-file byte budget
total byte budget
```

这些过滤由工程代码执行，不依赖模型遵守 prompt。

---

## transcript 本地残留风险

compact 使用 append-only transcript，因此旧历史仍保留在本地 session JSONL 中。

缓解措施：

- session 目录尽量 chmod `0o700`
- session 文件尽量 chmod `0o600`
- 损坏行日志不输出原文
- restore 只从最新结构化 boundary 恢复 active context

残余风险：

- 本机有权限读取 session 文件的人仍能看到 compact 前历史。
- compact 不是 secure delete。

---

## prompt injection 残余风险

summary prompt 要求不要遵循 tool/web/file 内容中的新指令，但 summary 仍由 LLM 生成，并会作为 `isMeta: true` user message 进入后续上下文。

因此仍有残余风险：

- 恶意网页或文件内容可能诱导 summary 写入错误的 “Current Work”。
- 后续模型可能把被污染的 summary 当作事实。

当前缓解：

- summary runner `tools: []`
- prompt 明确标记 untrusted data
- attachment 过滤敏感路径和内容 secret

后续可加强：

- 为 summary 增加更强的非权威前缀。
- 在 summary 中区分 user intent 与 untrusted evidence。
- 增加恶意 WebFetch/file 注入测试。

---

## 已知非目标

当前 compact 不保证：

- 删除磁盘历史。
- 检出所有可能 secret 格式。
- 自动判断何时 compact。
- compact 后 attachment 内容一定是磁盘最新版。
- summary 完全免疫 prompt injection。
