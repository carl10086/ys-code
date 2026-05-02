# Compact 后附件恢复

> 分析对象：`src/session/compact/attachments.ts`, `src/agent/file-state.ts`, `src/agent/attachments/normalize.ts` @ 73baf03
> 日期：2026-05-03

---

## 概述

compact summary 适合保留任务语义，但不适合承载大量代码原文。为了让 compact 后的模型继续拥有关键文件上下文，系统会从 `FileStateCache` 恢复最近读取过的文件 attachment。

当前 attachment restore 只恢复文件。skill、plan、background task 的恢复函数已经预留，但目前返回空数组。

---

## 输入来源

`createPostCompactFileAttachments()` 接收：

```text
fileStateCache
cwd
maxFiles
maxBytesPerFile
maxTotalBytes
```

它通过 `fileStateCache.snapshot()` 获取当前已读文件记录。snapshot 中包含：

- 文件路径
- 缓存内容
- 是否 partial read
- offset / limit
- 最近访问顺序

---

## 恢复策略

当前实现直接使用缓存中的 `entry.record.content` 作为 attachment 内容，不重新读取磁盘。

这样做的原因是：

- compact 后恢复的是“模型此前已经看过的材料”。
- 避免 compact 期间重新扩大 partial read 范围。
- 避免在恢复阶段额外触发文件读取副作用。

同时，只有全量读取记录才会恢复。以下记录会被跳过：

- `isPartialView === true`
- `offset !== undefined`
- `limit !== undefined`

---

## 预算限制

默认预算：

```text
maxFiles: 10
maxBytesPerFile: 200_000
maxTotalBytes: 400_000
```

预算按成功恢复的 attachment 计算。被跳过的候选文件不会消耗 `maxFiles` 名额。

如果单文件超过 `maxBytesPerFile`，跳过。

如果加入该文件会超过 `maxTotalBytes`，跳过。

---

## cwd containment

attachment restore 必须限制在当前 workspace 内。

实现会先解析真实路径：

```text
realCwd = realpath(cwd)
realEntryPath = realpath(entry.path)
```

然后通过相对路径判断 `realEntryPath` 是否位于 `realCwd` 内。

这可以阻止：

- `../` 路径逃逸
- 绝对路径逃逸
- symlink 指向 workspace 外部

---

## 敏感路径过滤

即使文件位于 cwd 内，也会跳过常见敏感路径。

当前过滤规则覆盖：

```text
.ssh/
.aws/
.kube/
.env*
.npmrc
.netrc
.pypirc
id_rsa
id_ed25519
known_hosts
*.pem
*.key
*credentials*
```

`.env*` 会覆盖 `.env`、`.env.local`、`.envrc` 等变体。

---

## 内容级 secret 检测

路径 denylist 不足以覆盖所有 secret。普通源码文件里也可能临时包含 token。

因此恢复 attachment 前还会调用：

```text
containsSecret(entry.record.content)
```

如果命中 secret redaction 规则，整个文件 attachment 会被跳过。

---

## attachment 形态

恢复后的消息 role 是 `attachment`，内容类型是 file：

```text
role: "attachment"
attachment.type: "file"
attachment.filePath
attachment.displayPath
attachment.content.file.content
```

后续发送给 LLM 前，`normalizeAttachment()` 会把它展开成 `<system-reminder>` 风格的 user message，模拟此前 FileReadTool 的结果。

---

## 不持久化 attachment

`SessionManager` 不会把 attachment message 写入 transcript。

这是因为 attachment 是 compact 后恢复的运行时上下文材料，而不是会话历史本体。restore 最新会话时，会从 transcript 恢复 boundary、summary 和命令记录；文件附件需要依赖新的运行时状态重新提供。

---

## 当前限制

- 当前只恢复文件 attachment。
- 恢复内容来自 cache snapshot，不保证是磁盘最新内容。
- secret detection 是启发式正则，不能保证覆盖所有凭据格式。
- 预算基于字节数，不是模型精确 token 数。
