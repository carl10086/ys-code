# Compact 消息模型

> 分析对象：`src/session/compact/types.ts`, `src/session/compact/messages.ts`, `src/session/entry-types.ts`, `src/agent/attachments/normalize.ts` @ 73baf03
> 日期：2026-05-03

---

## 概述

compact 的核心不是生成一段摘要文本，而是重建后续模型会看到的 active messages。

当前 compact 成功后的消息顺序是：

```text
compact_boundary
compact summary user meta message
/compact command user message
local-command-stdout user meta message
restored attachments
```

这些消息共同表达三件事：

- 旧历史已经被压缩。
- 后续模型应基于 summary 延续工作。
- 当前必要的精确材料通过 attachments 恢复。

---

## compact_boundary

`compact_boundary` 是结构标记，不是普通 LLM 消息。

类型定义位于 `src/session/compact/types.ts`：

```ts
export interface CompactBoundaryMessage {
  role: "compact_boundary";
  uuid: string;
  timestamp: number;
  parentUuid?: string | null;
  compactMetadata: CompactMetadata;
}
```

metadata 记录 compact 指标：

```text
trigger: "manual" | "auto"
preTokens
postTokens
tokensSavedByMicrocompact
clearedToolCallIds
```

当前只使用 `trigger: "manual"`，`"auto"` 是未来扩展位。

---

## 为什么 boundary 不发给 LLM

LLM provider 不认识 `compact_boundary` 这种 role。`normalizeMessages()` 在转换 LLM payload 时会跳过它：

```text
if (msg.role === "compact_boundary") {
  continue;
}
```

它的消费者主要是工程代码：

- `getMessagesAfterCompactBoundary()` 用它筛选最新 active context。
- `SessionLoader.restoreMessages()` 用它决定 restore 起点。
- `SessionManager.messageToEntry()` 把它持久化为 `CompactBoundaryEntry`。

---

## compact summary message

summary message 是 `role: "user"` 且 `isMeta: true` 的消息：

```text
role: "user"
isMeta: true
content: [{ type: "text", text: "Summary:\n..." }]
```

它会进入后续 LLM context，但通常不会作为普通用户发言展示。

选择 user meta message 的原因：

- 对齐现有 meta message 机制。
- 让后续模型自然看到“上一段会话总结”。
- 不需要引入新的 provider message role。

---

## command records

`AgentSession.compact()` 会把本次命令记录放入 compact 后上下文：

```text
/compact [instructions]
```

随后再追加一个 local command stdout meta message：

```text
<local-command-stdout>Compacted conversation: ...</local-command-stdout>
```

这样后续模型既知道用户触发过 compact，也知道 compact 的本地执行结果。

---

## attachments

attachments 位于 post-compact messages 尾部。当前主要来源是最近读取文件的缓存快照。

attachment message 不直接持久化到 transcript：

```text
SessionManager.appendMessage()
    if message.role === "attachment" return
```

原因是 attachment 是运行时上下文材料，不是用户/assistant 对话历史本体。

---

## buildPostCompactMessages

`buildPostCompactMessages()` 负责基础排序：

```text
boundaryMessage
summaryMessage
...messagesToKeep
...attachments
```

`compactConversation()` 先生成这个基础结果。随后 `AgentSession.compact()` 会把 `local-command-stdout` 追加到 `messagesToKeep` 后，再生成最终 messages。

最终顺序保持为：

```text
boundary
summary
command message
stdout meta
attachments
```

---

## 多次 compact

多次 compact 后，历史 transcript 中会出现多个 `compact_boundary`。

运行时和恢复时都只关注最新的结构化 boundary：

- `getMessagesAfterCompactBoundary()` 取 active messages 中最后一个 boundary 之后的消息。
- `SessionLoader.restoreMessages()` 在 active branch 中查找最后一个带 `compactMetadata` 的 boundary。

这避免再次 compact 时重复总结更早的已压缩历史。
