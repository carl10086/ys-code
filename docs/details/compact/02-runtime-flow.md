# Compact 运行时链路

> 分析对象：`src/commands/index.ts`, `src/commands/compact/*`, `src/tui/command-utils.ts`, `src/agent/session.ts`, `src/session/compact/conversation.ts` @ 73baf03
> 日期：2026-05-03

---

## 概述

一次 `/compact` 调用横跨四层：

```text
TUI command dispatch
    ↓
commands/compact local command
    ↓
AgentSession.compact()
    ↓
session/compact compactConversation()
```

关键点是：`/compact` 必须在本地闭环完成，本轮不能再调用 `session.prompt("/compact")`。

---

## 完整时序

```text
用户输入 /compact [instructions]
    |
    v
executeCommand(input, context)
    |
    |-- parseSlashCommand(input)
    |-- findCommand("compact")
    |-- command.type === "local"
    v
commands/compact.call(args, context)
    |
    |-- 构造 commandText
    |-- context.session.compact({ commandText, instructions })
    v
AgentSession.compact()
    |
    |-- 拒绝 streaming 中 compact
    |-- 拒绝重复 compact
    |-- 记录 messageSnapshot
    |-- compactConversation(...)
    |-- 检查 compact 期间 messages 未变化
    |-- 追加 local-command-stdout meta message
    |-- SessionManager.replaceMessages(postCompactMessages)
    |-- Agent.replaceMessages(postCompactMessages)
    v
commands/compact 返回 { type: "compact", displayText }
    |
    v
executeCommand 返回 { handled: true, compact: true, textResult }
    |
    v
dispatchCommandResult()
    |
    |-- appendUserMessage("/compact ...")
    |-- appendSystemMessage(displayText)
    |-- return true
    |-- 不调用 session.prompt()
```

---

## command 层

`/compact` 被注册为内置 local command：

```text
src/commands/compact/index.ts
src/commands/compact/compact.ts
```

`compact.ts` 做三件事：

1. 把 args 还原成完整命令文本。
2. 调用 `context.session.compact()`。
3. 返回 `{ type: "compact", displayText }`。

这层不直接接触 `compact_boundary`、summary、attachments，也不负责持久化。

---

## executeCommand 层

`executeCommand()` 对 local command 的返回值做分派：

```text
result.type === "compact"
    -> { handled: true, compact: true, textResult: result.displayText }
```

如果 local command 抛错，命令系统返回：

```text
{ handled: true, skipPrompt: true, textResult: "Command failed. See logs for details." }
```

这保证 local command 失败时也不会退回普通 prompt 路径。

---

## TUI 层

`dispatchCommandResult()` 识别两个“本地已处理，不应 query”的信号：

```text
result.compact || result.skipPrompt
```

命中后只做 UI 展示：

1. 显示用户输入。
2. 如果有 `textResult`，显示系统提示。
3. 直接返回。

不会进入普通分支：

```text
session.prompt(text, promptOptions)
```

---

## AgentSession 层

`AgentSession.compact()` 是原子替换的边界。

进入 compact 前：

- 如果当前 `isStreaming` 为 true，直接拒绝。
- 如果 `compactInProgress` 为 true，直接拒绝。
- 复制当前 messages 引用和浅快照，用于 compact 后检测 late message。

compact 成功后：

- 如果 messages 引用或元素列表发生变化，抛出错误并要求用户重试。
- 构造 `<local-command-stdout>...</local-command-stdout>` meta message。
- 调用 `SessionManager.replaceMessages()` append-only 持久化。
- 调用 `Agent.replaceMessages()` 替换内存 active messages。

`finally` 会重置 `compactInProgress`，避免失败后卡死。

---

## compactConversation 层

`compactConversation()` 是 compact service 主入口：

1. 取最后一个 `compact_boundary` 之后的 active messages。
2. 估算 compact 前 token。
3. 对 active messages 执行 `microcompactMessages()`。
4. 构造 compact prompt。
5. 调用 `summaryRunner({ prompt, messages })`。
6. 格式化并脱敏 summary。
7. 创建 `compact_boundary` 和 summary meta message。
8. 从 `FileStateCache` 恢复 post-compact attachments。
9. 组装 post-compact messages。
10. 估算 compact 后 token，并写回 boundary metadata。

summary 请求过长时，会截断较旧消息后重试一次。重试仍失败时，错误向外抛出，外层不会替换 messages。
