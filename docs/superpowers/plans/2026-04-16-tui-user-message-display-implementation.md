# TUI 显示用户输入消息实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 TUI 中用户发送的消息没有显示在消息列表中的问题。

**Architecture:** 在 `useAgent` 中暴露 `appendUserMessage` 方法，在 `app.tsx` 的 `handleSubmit` 中先插入 user 消息再调用 agent。

**Tech Stack:** TypeScript, React, Ink

---

### Task 1: 在 useAgent 中添加 appendUserMessage 方法

**Files:**
- Modify: `src/tui/hooks/useAgent.ts`

- [ ] **Step 1: 添加 appendUserMessage 方法**

在 `UseAgentResult` interface 中添加：

```typescript
/** 添加用户消息到列表 */
appendUserMessage: (text: string) => void;
```

在 `useAgent` 函数返回值中添加：

```typescript
return {
  agent,
  messages,
  shouldScrollToBottom,
  markScrolled: () => setShouldScrollToBottom(false),
  appendUserMessage: (text: string) => {
    setMessages((prev) => [...prev, { type: "user", text }]);
    setShouldScrollToBottom(true);
  },
};
```

---

### Task 2: 在 app.tsx 中调用 appendUserMessage

**Files:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: 解构 appendUserMessage 并在 handleSubmit 中使用**

修改解构：

```typescript
const { agent, messages, shouldScrollToBottom, markScrolled, appendUserMessage } = useAgent({
```

在 `handleSubmit` 开头插入：

```typescript
const handleSubmit = async (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;

  appendUserMessage(trimmed);

  if (isStreaming) {
    agent.steer({ role: "user", content: [{ type: "text", text: trimmed }], timestamp: Date.now() });
  } else {
    try {
      await agent.prompt(trimmed);
    } catch (err) {
      // 错误会通过 AgentEvent 的 message_update / agent_end 体现
    }
  }
};
```

- [ ] **Step 2: 运行类型检查和测试**

Run: `bun run typecheck && bun test src/tui/`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add src/tui/hooks/useAgent.ts src/tui/app.tsx
git commit -m "feat(tui): display user message in message list"
```
