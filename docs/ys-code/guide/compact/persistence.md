# Compact 持久化与恢复

> 分析对象：`src/session/session-manager.ts`, `src/session/session-loader.ts`, `src/session/session-storage.ts`, `src/session/entry-types.ts` @ 73baf03
> 日期：2026-05-03

---

## 概述

compact 有两个状态面：

1. 内存中的 active messages。
2. 磁盘上的 session transcript。

compact 成功后，两者都要更新：

```text
SessionManager.replaceMessages(postCompactMessages)
Agent.replaceMessages(postCompactMessages)
```

内存替换让当前会话立即使用压缩后的上下文。transcript append 让重启后能够从最新 compact boundary 恢复。

---

## append-only 策略

`SessionManager.replaceMessages()` 不是覆盖 session 文件，而是把 compact 后的消息追加到 JSONL transcript 末尾。

伪代码：

```text
parentUuid = lastUuid

for message in postCompactMessages:
    if message.role === "attachment":
        continue

    entry = messageToEntry(message, parentUuid)
    appendEntry(entry)
    parentUuid = entry.uuid

lastUuid = parentUuid
```

这保留了完整历史，同时在尾部追加新的 active branch。

---

## 为什么不覆盖旧 transcript

append-only 的好处：

- 不破坏历史记录。
- 不需要重写大文件。
- 与现有 session entry 链式结构兼容。
- compact 行为可以通过 transcript 审计。

代价：

- compact 前历史仍留在磁盘。
- `/compact` 不等价于删除敏感信息。
- session 文件会随时间增长。

因此 session 文件权限必须收紧，用户文档也要明确 compact 只压缩 active context。

---

## CompactBoundaryEntry

`compact_boundary` 会持久化成 `CompactBoundaryEntry`：

```text
type: "compact_boundary"
summary: ""
tokensBefore
tokensAfter
compactMetadata
```

`tokensBefore` 来自 `compactMetadata.preTokens`。

`tokensAfter` 来自 `compactMetadata.postTokens`，如果缺失则为 0。

新版 restore 依赖 `compactMetadata` 判断这是结构化 boundary。

---

## active branch 恢复

`SessionLoader.restoreMessages()` 先通过 parentUuid 链找 active branch：

```text
entries
    -> 找所有 leaves
    -> 取最后一个 leaf
    -> 沿 parentUuid 回溯到 header
    -> 得到 activeBranch
```

然后在 active branch 内查找最后一个结构化 compact boundary：

```text
entry.type === "compact_boundary" && entry.compactMetadata !== undefined
```

如果找到了，就从这个 boundary 开始恢复：

```text
entriesToRestore = activeBranch.slice(lastStructuredCompactIndex)
```

这意味着恢复后的 active messages 包含：

```text
compact_boundary
summary meta message
command record
stdout meta message
...
```

旧 boundary 之前的历史不会进入恢复后的 active context。

---

## 旧 boundary 兼容

如果遇到没有 `compactMetadata` 的旧 `compact_boundary` entry，loader 会把它转换成普通 system message：

```text
role: "system"
content: entry.summary
```

这用于兼容早期简化 compact 逻辑。

新版 compact 只把带 `compactMetadata` 的 boundary 当作 active context 截断点。

---

## session 文件权限

`SessionStorage` 会尽量收紧本地 transcript 权限：

```text
session directory: 0o700
session file:      0o600
```

发生在三个位置：

- 构造 `SessionStorage` 时创建或 chmod baseDir。
- `createSession()` 创建 session 文件时使用 `mode: 0o600`。
- `appendEntry()` 每次追加后 chmod session 文件。

如果 chmod 失败，会记录 warn，但不会中断 session 功能。

---

## 损坏行处理

`readAllEntries()` 逐行解析 JSONL。如果某一行损坏，会跳过该行并记录：

```text
filePath
lineIndex
byteLength
```

日志不会包含损坏行原文，避免把可能含 secret 的 transcript 片段写入日志。

---

## restoreSession 集成

`AgentSession` 构造时如果传入 `restoreSession: true`：

1. `SessionManager.restoreLatest()` 找最新 session 文件。
2. `restoreMessages()` 恢复 active context。
3. 恢复结果 push 到 `agent.state.messages`。

如果 session 文件中已有 compact，恢复会从最新结构化 `compact_boundary` 开始，而不是读回 compact 前的长历史。
