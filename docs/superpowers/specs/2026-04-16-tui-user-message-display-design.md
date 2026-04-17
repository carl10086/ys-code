# TUI 显示用户输入消息设计文档

**目标：** 修复 TUI 中用户发送的消息没有显示在消息列表中的问题。

**问题分析：**
- `useAgent` 的 `agent.subscribe` 只处理 assistant 相关事件（`turn_start`、`message_update`、`tool_execution_*`、`turn_end`）
- 当用户在 `PromptInput` 中输入并提交时，`app.tsx` 直接调用 `agent.prompt()` 或 `agent.steer()`，但没有任何逻辑将 user 消息添加到 UI 的 `messages` 状态中
- 因此消息列表只显示 assistant 的回复，不显示用户的提问

**设计方案：**
1. 在 `useAgent.ts` 中暴露 `appendUserMessage(text: string)` 函数，用于将 `{ type: "user", text }` 添加到 `messages` 状态
2. 在 `app.tsx` 的 `handleSubmit` 中，在调用 `agent.prompt()` 或 `agent.steer()` **之前**，先调用 `appendUserMessage(trimmed)` 将用户输入插入消息列表

**文件变更：**
- `src/tui/hooks/useAgent.ts`：添加 `appendUserMessage` 方法到返回值
- `src/tui/app.tsx`：在 `handleSubmit` 中调用 `appendUserMessage`
