# Clear Command 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/clear` 命令，清空 UI 消息、创建新 AgentSession、生成新 session ID

**Architecture:** 最小化实现。useAgent 使用 ref 管理 session，resetSession 创建新实例并清空 UI 消息。CommandContext 传递 resetSession 回调给 command。

**Tech Stack:** TypeScript, React (Ink), Bun

---

## 文件结构

```
src/agent/session.ts          # 添加 regenerateSessionId()
src/tui/hooks/useAgent.ts     # 重构为 ref 管理 session，添加 resetSession()
src/commands/types.ts         # CommandContext 添加 resetSession
src/tui/app.tsx               # 传递 resetSession 到 context
src/commands/clear/clear.ts  # 调用 context.resetSession()
```

---

## Task 1: AgentSession 添加 regenerateSessionId

**Files:**
- Modify: `src/agent/session.ts`

- [ ] **Step 1: 读取 session.ts 确认 sessionId 属性位置**

读取 `src/agent/session.ts` 第 200 行附近，确认 `sessionId` 属性的定义位置。

- [ ] **Step 2: 添加 regenerateSessionId 方法**

在 `sessionId` 属性定义后添加方法：

```typescript
/** 生成新 session ID */
regenerateSessionId(): void {
  logger.info("Session ID regenerated");
  this.sessionId = crypto.randomUUID();
}
```

- [ ] **Step 3: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/agent/session.ts
git commit -m "feat(session): add regenerateSessionId method"
```

---

## Task 2: useAgent 重构为 ref 管理 session

**Files:**
- Modify: `src/tui/hooks/useAgent.ts`
- Test: `src/tui/hooks/useAgent.test.ts` (如存在)

- [ ] **Step 1: 读取现有 useAgent 实现**

读取 `src/tui/hooks/useAgent.ts` 完整内容，确认当前 session 管理方式和事件订阅逻辑。

- [ ] **Step 2: 将 session 改为 useRef 管理**

将第 30-36 行:
```typescript
const session = useMemo(() => {
  return new AgentSession({
    cwd: process.cwd(),
    model: options.model,
    apiKey: options.apiKey,
  });
}, []);
```

改为:
```typescript
const sessionRef = useRef<AgentSession>(
  new AgentSession({
    cwd: process.cwd(),
    model: options.model,
    apiKey: options.apiKey,
  })
);
```

- [ ] **Step 3: 添加 unsubscribeRef 管理订阅**

在 `useState` 声明后添加:
```typescript
const unsubscribeRef = useRef<() => void>(null);
```

- [ ] **Step 4: 抽离订阅逻辑为函数**

添加:
```typescript
const subscribeToSession = useCallback((session: AgentSession) => {
  unsubscribeRef.current?.();
  unsubscribeRef.current = session.subscribe((event: AgentSessionEvent) => {
    setMessages((prev) => {
      const next = [...prev];
      switch (event.type) {
        case "turn_start": {
          next.push({ type: "assistant_start" });
          break;
        }
        case "thinking_delta": {
          const last = next[next.length - 1];
          if (last && last.type === "thinking") {
            last.text += event.text;
          } else {
            next.push({ type: "thinking", text: event.text });
          }
          break;
        }
        case "answer_delta": {
          const last = next[next.length - 1];
          if (last && last.type === "text") {
            last.text += event.text;
          } else {
            next.push({ type: "text", text: event.text });
          }
          break;
        }
        case "tool_start": {
          next.push({ type: "tool_start", toolName: event.toolName, args: event.args });
          break;
        }
        case "tool_end": {
          next.push({
            type: "tool_end",
            toolName: event.toolName,
            isError: event.isError,
            summary: event.summary,
            timeMs: event.timeMs,
          });
          break;
        }
        case "turn_end": {
          next.push({
            type: "assistant_end",
            tokens: event.tokens,
            cost: event.cost,
            timeMs: event.timeMs,
          });
          break;
        }
      }
      return next;
    });
    setShouldScrollToBottom(true);
  });
}, []);
```

- [ ] **Step 5: 修改 useEffect 订阅逻辑**

将:
```typescript
useEffect(() => {
  return session.subscribe((event: AgentSessionEvent) => {
    // ...
  });
}, [session]);
```

改为:
```typescript
useEffect(() => {
  subscribeToSession(sessionRef.current);
  return () => unsubscribeRef.current?.();
}, [subscribeToSession]);
```

- [ ] **Step 6: 添加 resetSession 方法**

在 `appendSystemMessage` 定义后添加:
```typescript
const resetSession = useCallback(() => {
  unsubscribeRef.current?.();
  sessionRef.current = new AgentSession({
    cwd: process.cwd(),
    model: options.model,
    apiKey: options.apiKey,
  });
  sessionRef.current.regenerateSessionId();
  subscribeToSession(sessionRef.current);
  setMessages([]);
}, [options.model, options.apiKey, subscribeToSession]);
```

- [ ] **Step 7: 更新返回值**

将 `return` 中的 `session` 改为 `session: sessionRef.current`，并添加 `resetSession`:
```typescript
return {
  session: sessionRef.current,
  messages,
  shouldScrollToBottom,
  markScrolled,
  appendUserMessage,
  appendSystemMessage,
  resetSession,
};
```

- [ ] **Step 8: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: 运行测试（如存在）**

Run: `bun test src/tui/hooks/useAgent.test.ts` (或 `bun test` 如无特定文件)
Expected: 测试通过

- [ ] **Step 10: Commit**

```bash
git add src/tui/hooks/useAgent.ts
git commit -m "feat(useAgent): refactor to ref-based session management and add resetSession"
```

---

## Task 3: CommandContext 添加 resetSession

**Files:**
- Modify: `src/commands/types.ts`

- [ ] **Step 1: 读取 types.ts 确认现有定义**

读取 `src/commands/types.ts` 确认 CommandContext 接口定义。

- [ ] **Step 2: 添加 resetSession 到 CommandContext**

在 `CommandContext` 接口中添加:
```typescript
/** 重置会话（创建新 AgentSession 并清空 UI） */
resetSession: () => void;
```

- [ ] **Step 3: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/commands/types.ts
git commit -m "feat(commands): add resetSession to CommandContext"
```

---

## Task 4: app.tsx 传递 resetSession

**Files:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: 读取 app.tsx 确认 handleCommand**

读取 `src/tui/app.tsx` 确认 handleCommand 如何构建 context。

- [ ] **Step 2: 从 useAgent 解构 resetSession**

将第 16 行:
```typescript
const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage } = useAgent({
```

改为:
```typescript
const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage, resetSession } = useAgent({
```

- [ ] **Step 3: 在 executeCommand 调用中传递 resetSession**

将第 26-30 行:
```typescript
const result = await executeCommand(text, {
  session,
  appendUserMessage,
  appendSystemMessage,
});
```

改为:
```typescript
const result = await executeCommand(text, {
  session,
  appendUserMessage,
  appendSystemMessage,
  resetSession,
});
```

- [ ] **Step 4: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/tui/app.tsx
git commit -m "feat(app): pass resetSession to command context"
```

---

## Task 5: clear command 调用 resetSession

**Files:**
- Modify: `src/commands/clear/clear.ts`

- [ ] **Step 1: 确认现有实现**

读取 `src/commands/clear/clear.ts` 确认当前实现。

- [ ] **Step 2: 修改 call 函数**

将:
```typescript
export const call: LocalCommandCall = async (_args, context) => {
  context.session.reset();
  return { type: "skip" };
};
```

改为:
```typescript
export const call: LocalCommandCall = async (_args, context) => {
  context.resetSession();
  return { type: "skip" };
};
```

- [ ] **Step 3: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/commands/clear/clear.ts
git commit -m "feat(clear): use context.resetSession() instead of session.reset()"
```

---

## Task 6: 集成测试

**Files:**
- Modify: 无（手动测试）

- [ ] **Step 1: 启动应用**

Run: `bun run src/cli/index.ts` (或项目实际启动命令)

- [ ] **Step 2: 执行 /clear 命令**

在应用中输入任意消息，然后输入 `/clear`

- [ ] **Step 3: 验证结果**

- [ ] UI 消息列表已清空
- [ ] 新消息使用新 session ID（可通过日志确认）
- [ ] 旧 session 的订阅已取消（无事件泄漏）

---

## 验证清单

- [ ] `bun run tsc --noEmit` 无错误
- [ ] `/clear` 后 UI 消息为空
- [ ] 连续执行 `/clear` 不会出错
- [ ] 新 session ID 与旧不同
