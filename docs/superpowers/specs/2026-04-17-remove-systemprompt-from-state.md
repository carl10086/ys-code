# 从 AgentState 移除 SystemPrompt 并统一为函数的设计规格

## 问题

当前 `ys-code` 的 `AgentState` 和 `AgentContext` 中仍然保留了 `systemPrompt` 字段，这与 `claude-code-haha` 的设计不一致：

1. `claude-code-haha` 中 `systemPrompt` 是 `runAgent` 的局部变量，直接作为参数传给 `query()`，**不存在于任何持久化 state 中**。
2. `systemPrompt` 本质上是每次 loop 运行前的**配置输入/计算结果**，而不是随时间演变的**运行时状态**（如 messages、isStreaming）。
3. `AgentOptions.systemPrompt` 同时支持 `SystemPrompt` 和 `((context) => Promise<SystemPrompt>)` 两种形式，导致 `Agent` 内部必须做 `typeof === "function"` 分支判断，增加了不必要的复杂性。

## 设计目标

1. 从 `AgentState` 和 `AgentContext` 中彻底移除 `systemPrompt` 字段。
2. `AgentOptions.systemPrompt` 统一为函数签名：`(context: AgentContext) => Promise<SystemPrompt>`。
3. `Agent` 内部构造函数直接保存函数引用；`createLoopConfig` 中统一 `await` 调用，不再写入 `_state`。
4. 删除 CLI 中 `/system` 命令（因为它依赖 `agent.state.systemPrompt`）。
5. 更新所有测试、CLI、TUI 和示例代码，静态 prompt 统一改为 `async () => asSystemPrompt([...])`。

## 核心类型变更

### `src/agent/types.ts`

`AgentContext`：
```typescript
export interface AgentContext {
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}
```

`AgentState`：
```typescript
export interface AgentState {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

`AgentLoopConfig` 保持不变（仍包含 `systemPrompt?: SystemPrompt`）。

### `src/agent/agent.ts`

`AgentOptions`：
```typescript
export interface AgentOptions {
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  systemPrompt?: (context: AgentContext) => Promise<SystemPrompt>;
  // ... 其他字段不变
}
```

`Agent` 类属性：
```typescript
public systemPrompt?: (context: AgentContext) => Promise<SystemPrompt>;
```

构造函数中归一化为函数：
```typescript
constructor(options: AgentOptions = {}) {
  this._state = createMutableAgentState(options.initialState);
  this.systemPrompt = options.systemPrompt ?? (async () => asSystemPrompt([""]));
  // ... 其他字段赋值不变
}
```

`createLoopConfig` 中统一调用：
```typescript
private async createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): Promise<AgentLoopConfig> {
  let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
  const resolvedSystemPrompt = await this.systemPrompt(this.createContextSnapshot());

  return {
    model: this._state.model,
    reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
    sessionId: this.sessionId,
    onPayload: this.onPayload,
    transport: this.transport,
    thinkingBudgets: this.thinkingBudgets,
    maxRetryDelayMs: this.maxRetryDelayMs,
    toolExecution: this.toolExecution,
    beforeToolCall: this.beforeToolCall,
    afterToolCall: this.afterToolCall,
    convertToLlm: this.convertToLlm,
    transformContext: this.transformContext,
    getApiKey: this.getApiKey,
    systemPrompt: resolvedSystemPrompt,
    getSteeringMessages: async () => {
      if (skipInitialSteeringPoll) {
        skipInitialSteeringPoll = false;
        return [];
      }
      return this.steeringQueue.drain();
    },
    getFollowUpMessages: async () => this.followUpQueue.drain(),
  };
}
```

`createContextSnapshot` 移除 `systemPrompt`：
```typescript
private createContextSnapshot(): AgentContext {
  return {
    messages: this._state.messages.slice(),
    tools: this._state.tools.slice(),
  };
}
```

`createMutableAgentState` 不再处理 `systemPrompt`：
```typescript
function createMutableAgentState(
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>,
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? "off",
    get tools() { return tools; },
    set tools(nextTools: AgentTool<any>[]) { tools = nextTools.slice(); },
    get messages() { return messages; },
    set messages(nextMessages: AgentMessage[]) { messages = nextMessages.slice(); },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}
```

## CLI / TUI / 示例更新

### `src/cli/chat.ts`
- 删除 `import { asSystemPrompt } ...`
- `new Agent({ systemPrompt: async () => asSystemPrompt([systemPromptText]), ... })`
- 删除 `/system` 分支处理

### `src/tui/hooks/useAgent.ts`
- `new Agent({ systemPrompt: async () => asSystemPrompt([options.systemPrompt]), ... })`

### `examples/agent-math.ts`
- `new Agent({ systemPrompt: async () => asSystemPrompt(["You are a math assistant..."]), ... })`

### `examples/debug-agent-chat.ts`
- `new Agent({ systemPrompt: async () => asSystemPrompt(["你是一个乐于助人的助手。"]), ... })`

## 测试更新

- `src/agent/__tests__/agent-loop.test.ts`：所有 `createMockContext` 移除 `systemPrompt`；如有需要可在 `AgentLoopConfig` 中直接提供 `systemPrompt: asSystemPrompt(["test"])`
- `src/agent/__tests__/stream-assistant.test.ts`：同上
- `src/agent/__tests__/tool-execution.test.ts`：同上
- 如测试中存在 `expect(context.systemPrompt)` 的断言，一并删除

## 验证

- `bun tsc --noEmit` 通过
- `bun test src/` 通过
- `examples/agent-math.ts`、`examples/debug-agent-chat.ts` 运行正常
