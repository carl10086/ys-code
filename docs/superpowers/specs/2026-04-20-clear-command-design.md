# Clear Command 设计方案

## 背景

当前 `clear` command 实现存在问题：执行 `/clear` 后，后端 AgentSession 状态被重置，但 UI 的消息列表未清除，用户仍看到所有旧消息。

参考 CC 的 `clearConversation` 实现，设计 ys-code 的最小化 clear 功能。

## 需求

- 清空 UI 消息列表
- 重置 AgentSession（创建新实例）
- 生成新 session ID（仅内存）
- 不需要 hooks、任务管理、MCP 状态等复杂功能

## 架构设计

### 核心改动

#### 1. AgentSession 添加 sessionId 重生方法

**文件**: `src/agent/session.ts`

```typescript
// 新增方法
regenerateSessionId(): void {
  this.sessionId = crypto.randomUUID();
}
```

#### 2. useAgent 添加 resetSession 方法

**文件**: `src/tui/hooks/useAgent.ts`

```typescript
export interface UseAgentResult {
  // ... 现有字段
  resetSession: () => void;  // 新增
}
```

**实现逻辑**:
```typescript
const sessionRef = useRef<AgentSession>(null);

// 在 useEffect 中订阅 session 事件，返回 unsubscribe 函数

const resetSession = useCallback(() => {
  // 1. 取消旧 session 订阅（调用 unsubscribe）
  // 2. 创建新 AgentSession
  sessionRef.current = new AgentSession({...});
  // 3. 重新订阅新 session
  // 4. 清空 UI messages: setMessages([])
}, []);

return { session: sessionRef.current, messages, ..., resetSession };
```

#### 3. CommandContext 添加 resetSession 回调

**文件**: `src/commands/types.ts`

```typescript
export interface CommandContext {
  session: AgentSession;
  appendUserMessage: (text: string) => void;
  appendSystemMessage: (text: string) => void;
  resetSession: () => void;  // 新增
}
```

#### 4. TUI 层传递 resetSession 到 CommandContext

**文件**: `src/tui/app.tsx` (待确认)

需要在创建 CommandContext 时传入 resetSession。

#### 5. clear command 调用 resetSession

**文件**: `src/commands/clear/clear.ts`

```typescript
export const call: LocalCommandCall = async (_args, context) => {
  context.resetSession();
  return { type: "skip" };
};
```

## 详细实现步骤

### Step 1: AgentSession 添加 regenerateSessionId

```typescript
// src/agent/session.ts

regenerateSessionId(): void {
  logger.info("Session ID regenerated");
  this.sessionId = crypto.randomUUID();
}
```

### Step 2: useAgent 重构为 ref 管理 session

将 session 从 useState 改为 useRef，允许后续替换：

```typescript
// src/tui/hooks/useAgent.ts

const sessionRef = useRef<AgentSession>(
  new AgentSession({
    cwd: process.cwd(),
    model: options.model,
    apiKey: options.apiKey,
  })
);

const [messages, setMessages] = useState<UIMessage[]>([]);
const unsubscribeRef = useRef<() => void>(null);

// 订阅逻辑抽离为函数
const subscribeToSession = useCallback((session: AgentSession) => {
  unsubscribeRef.current?.();
  unsubscribeRef.current = session.subscribe((event) => {
    // 现有事件处理逻辑
  });
}, []);

// 初始化订阅
useEffect(() => {
  subscribeToSession(sessionRef.current);
}, [subscribeToSession]);

// resetSession 实现
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

return {
  session: sessionRef.current,
  messages,
  resetSession,
  // ... 其他字段
};
```

### Step 3: CommandContext 添加 resetSession

```typescript
// src/commands/types.ts

export interface CommandContext {
  session: AgentSession;
  appendUserMessage: (text: string) => void;
  appendSystemMessage: (text: string) => void;
  resetSession: () => void;
}
```

### Step 4: TUI 层传递 resetSession

**文件**: `src/tui/app.tsx`

```typescript
// App 组件中，从 useAgent 获取 resetSession
const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage, resetSession } = useAgent({
  model,
  apiKey,
});

// handleCommand 中传递 resetSession
const handleCommand = async (text: string): Promise<boolean> => {
  const result = await executeCommand(text, {
    session,
    appendUserMessage,
    appendSystemMessage,
    resetSession,  // 新增
  });
  // ...
};
```

### Step 5: clear command 简化

```typescript
// src/commands/clear/clear.ts

export const call: LocalCommandCall = async (_args, context) => {
  context.resetSession();
  return { type: "skip" };
};
```

## 测试要点

1. 执行 `/clear` 后，UI 消息列表为空
2. 执行 `/clear` 后，新消息使用新 session ID
3. 旧 session 的订阅已取消，不会有事件泄漏
4. 连续执行 `/clear` 不会出问题

## 不包含的功能

- SessionEnd/SessionStart hooks
- 任务管理（前台/后台任务）
- MCP 状态重置
- 归因状态清理
- 会话持久化（session ID 仅存内存）
