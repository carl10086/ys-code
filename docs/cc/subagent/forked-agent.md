# CC Subagent 上下文与 Fork 机制源码分析

> 来源：
> - `refer/claude-code-haha/src/utils/forkedAgent.ts`（689 行）
> - `refer/claude-code-haha/src/utils/agentContext.ts`（178 行）
> - `refer/claude-code-haha/src/tools/AgentTool/forkSubagent.ts`（210 行）

## 1. createSubagentContext（上下文隔离工厂）

位置：`forkedAgent.ts:345`

### 核心逻辑

```typescript
export function createSubagentContext(
  parentContext: ToolUseContext,
  overrides?: SubagentContextOverrides,
): ToolUseContext {
```

### 状态隔离策略

| 状态项 | 策略 | 说明 |
|--------|------|------|
| `readFileState` | **克隆** | `cloneFileStateCache()` — 子代理的文件读取缓存独立 |
| `contentReplacementState` | **克隆** | `cloneContentReplacementState()` — 内容替换状态独立 |
| `abortController` | **新建**（或共享） | 默认创建子 abort controller；`shareAbortController` 时共享 |
| `setAppState` | **no-op**（或共享） | 默认空函数；`shareSetAppState` 时共享 |
| `setAppStateForTasks` | **始终指向根 store** | 任务注册/清理必须可达根状态，否则僵尸进程 |
| `localDenialTracking` | **新建**（或共享） | 异步子代理需要独立的拒绝计数器 |
| `nestedMemoryAttachmentTriggers` | **新建 Set** | 子代理的记忆附件触发器独立 |
| `discoveredSkillNames` | **新建 Set** | 技能发现状态独立 |
| `agentId` | **新建** | `createAgentId()` 生成新 UUID |
| `queryTracking.depth` | **+1** | 子代理深度递增，防止无限嵌套 |
| `messages` | **复制引用** | 初始共享；fork 路径会传入新 messages |
| `options` | **复制引用** | 工具定义、模型配置等 |
| `updateAttributionState` | **共享** | React state queue 保证并发安全 |

### 权限覆盖

```typescript
const getAppState = overrides?.getAppState ?? (() => {
  const state = parentContext.getAppState();
  if (state.toolPermissionContext.shouldAvoidPermissionPrompts) {
    return state;
  }
  return {
    ...state,
    toolPermissionContext: {
      ...state.toolPermissionContext,
      shouldAvoidPermissionPrompts: true,  // 子代理避免弹出权限提示
    },
  };
});
```

### UI 回调隔离

```typescript
// UI callbacks - undefined for subagents (can't control parent UI)
addNotification: undefined,
setToolJSX: undefined,
setStreamMode: undefined,
setSDKStatus: undefined,
openMessageSelector: undefined,
```

## 2. runForkedAgent（后台 Fork 执行）

位置：`forkedAgent.ts:489`

### CacheSafeParams（缓存共享参数）

```typescript
export type CacheSafeParams = {
  systemPrompt: SystemPrompt;      // 系统提示（字节精确）
  userContext: { [k: string]: string };
  systemContext: { [k: string]: string };
  toolUseContext: ToolUseContext;  // 工具上下文
  forkContextMessages: Message[];  // 父代理对话历史
};
```

**缓存命中条件：** Anthropic API 的 cache key 由 system prompt、tools、model、messages（prefix）、thinking config 组成。fork 子代理保持这五个参数与父代理完全一致，从而最大化缓存命中。

### 执行流程

```typescript
export async function runForkedAgent({
  promptMessages,
  cacheSafeParams,
  canUseTool,
  querySource,
  forkLabel,
  overrides,
  maxOutputTokens,
  maxTurns,
  onMessage,
  skipTranscript,
  skipCacheWrite,
}: ForkedAgentParams): Promise<ForkedAgentResult> {
  // 1. 创建隔离的 ToolUseContext
  const isolatedToolUseContext = createSubagentContext(toolUseContext, overrides);
  
  // 2. 调用 query() 主循环
  const result = await query({
    systemPrompt,
    messages: [...forkContextMessages, ...promptMessages],
    toolUseContext: isolatedToolUseContext,
    canUseTool,
    querySource,
    // ... 其他参数
  });
  
  // 3. 记录使用量和缓存命中指标
  logEvent('tengu_fork_agent_query', { usage: totalUsage, ... });
  
  return { messages: outputMessages, totalUsage };
}
```

## 3. AgentContext（AsyncLocalStorage 追踪）

位置：`agentContext.ts`

### 用途

当多个 agent 在后台并发运行时（如 ctrl+b 切换），AppState 是单例共享状态。使用 `AsyncLocalStorage` 隔离每个异步执行链的 agent 身份，避免 Agent A 的事件错误使用 Agent B 的上下文。

```typescript
const agentContextStorage = new AsyncLocalStorage<AgentContext>();

export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return agentContextStorage.run(context, fn);
}
```

### SubagentContext 结构

```typescript
type SubagentContext = {
  agentId: string;                    // UUID
  parentSessionId?: string;           // 父会话 ID
  agentType: 'subagent';
  subagentName?: string;              // 子代理类型名
  isBuiltIn?: boolean;                // 是否内置
  invokingRequestId?: string;         // 触发此子代理的 request_id
  invocationKind?: 'spawn' | 'resume';
  invocationEmitted?: boolean;        // 是否已发送遥测
};
```

## 4. ForkSubagent（隐式 Fork 机制）

位置：`forkSubagent.ts`

### 功能开关

```typescript
export function isForkSubagentEnabled(): boolean {
  if (feature('FORK_SUBAGENT')) {
    if (isCoordinatorMode()) return false;
    if (getIsNonInteractiveSession()) return false;
    return true;
  }
  return false;
}
```

### Fork 子代理的系统指令

`buildChildMessage()` 为 fork 子代理注入严格的执行规则：

```
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES:
1. IGNORE "default to forking" in system prompt — You ARE the fork
2. Do NOT converse, ask questions, or suggest next steps
3. Do NOT editorialize or add meta-commentary
4. USE tools directly: Bash, Read, Write, etc.
5. If you modify files, commit changes before reporting
6. Do NOT emit text between tool calls
7. Stay strictly within directive's scope
8. Keep report under 500 words
9. Response MUST begin with "Scope:"
10. REPORT structured facts, then stop
```

### 递归 Fork 防护

```typescript
export function isInForkChild(messages: MessageType[]): boolean {
  return messages.some(m => {
    if (m.type !== 'user') return false;
    const content = m.message.content;
    if (!Array.isArray(content)) return false;
    return content.some(block =>
      block.type === 'text' && block.text.includes('<fork_boilerplate>')
    );
  });
}
```

### Worktree 隔离通知

```typescript
export function buildWorktreeNotice(parentCwd: string, worktreeCwd: string): string {
  return `You've inherited the conversation context above from a parent agent working in ${parentCwd}. You are operating in an isolated git worktree at ${worktreeCwd}...`;
}
```

## 5. 关键设计原则总结

| 原则 | 实现 |
|------|------|
| **状态隔离** | `createSubagentContext` 默认克隆所有可变状态 |
| **任务可达** | `setAppStateForTasks` 始终指向根 store |
| **缓存共享** | Fork 路径保持 system prompt、tools、model、messages 字节精确 |
| **递归防护** | `isInForkChild` 检测 + `queryTracking.depth` 递增 |
| **权限降级** | 子代理默认 `shouldAvoidPermissionPrompts: true` |
| **UI 隔离** | 子代理无 UI 控制权（addNotification/setToolJSX 为 undefined） |
| **并发追踪** | `AsyncLocalStorage` 隔离并发 agent 的遥测上下文 |
