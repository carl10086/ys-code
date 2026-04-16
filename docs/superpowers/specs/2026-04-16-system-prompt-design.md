# SystemPrompt 统一为 branded `string[]` 设计规格

## 问题

当前 `ys-code` 的 `systemPrompt` 实现存在类型分裂和实际 bug：

1. `AgentState.systemPrompt` 和 `AgentContext.systemPrompt` 仍是 `string`
2. `AgentLoopConfig.systemPrompt` 和 `Context.systemPrompt` 是 `string | string[]`
3. `stream-assistant.ts:61` 构造 `llmContext` 时使用的是 `context.systemPrompt`（永远是 `string`），**完全忽略了 `config.systemPrompt`**，导致 `buildSystemPrompt` 返回的 `string[]` 根本到不了 Anthropic provider
4. 这与 `claude-code-haha` 的设计不一致：cc 使用 branded type `SystemPrompt = readonly string[]`，所有地方统一为数组，不支持 `string`

## 设计目标

1. 引入 branded type `SystemPrompt = readonly string[]`
2. 所有代码中 `systemPrompt` 统一为 `SystemPrompt`，**彻底删除 `string` 支持**
3. 将 `systemPrompt` 从 `AgentOptions.initialState` 中移出，放到 `AgentOptions` 顶层，支持：
   - `SystemPrompt`（静态数组）
   - `(context: AgentContext) => Promise<SystemPrompt>`（动态构建函数）
4. 修复 `stream-assistant.ts` 中 `config.systemPrompt` 被忽略的 bug
5. 简化 Anthropic provider 的 `buildParams`，因为传入的 `systemPrompt` 一定是数组
6. 更新所有测试、CLI、TUI 和示例代码

## 核心类型变更

### `src/core/ai/types.ts`

新增 branded type 和工厂函数：

```typescript
export type SystemPrompt = readonly string[] & { readonly __brand: 'SystemPrompt' };

export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as unknown as SystemPrompt;
}
```

`Context.systemPrompt` 改为：

```typescript
export interface Context {
  systemPrompt?: SystemPrompt;
  messages: Message[];
  tools?: Tool[];
}
```

### `src/agent/types.ts`

- `AgentContext.systemPrompt: SystemPrompt`
- `AgentState.systemPrompt: SystemPrompt`
- `AgentLoopConfig.systemPrompt?: SystemPrompt`

## Agent 层重构

### `AgentOptions` 改造

```typescript
export interface AgentOptions {
  initialState?: Partial<Omit<AgentState, "systemPrompt" | "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  systemPrompt?: SystemPrompt | ((context: AgentContext) => Promise<SystemPrompt>);
  // ... 其他字段不变
}
```

移除 `buildSystemPrompt` 字段。

### `Agent` 类改造

- 删除 `public buildSystemPrompt` 属性
- 新增 `public systemPrompt?: SystemPrompt | ((context: AgentContext) => Promise<SystemPrompt>)`
- 构造函数中处理 `systemPrompt`：
  - 如果是函数，`_state.systemPrompt` 初始化为 `asSystemPrompt([""])`
  - 如果是静态数组，直接存入 `_state.systemPrompt`
- `createLoopConfig` 中解析 `systemPrompt`：
  - 如果是函数，调用并更新 `_state.systemPrompt`
  - 否则使用 `_state.systemPrompt`
  - 始终返回 `SystemPrompt`

## 修复 stream-assistant bug

在 `src/agent/stream-assistant.ts` 中：

```typescript
const llmContext: Context = {
  systemPrompt: config.systemPrompt,  // 修复：原来是 context.systemPrompt
  messages: llmMessages,
  tools: (context.tools ?? []) as Tool[],
};
```

## Anthropic Provider 简化

`buildSystemBlocks` 签名改为接受 `readonly string[]`，直接兼容 `SystemPrompt`。

`buildParams` 中简化：

```typescript
if (context.systemPrompt) {
  params.system = buildSystemBlocks(context.systemPrompt, cacheControl);
}
```

删除 `string` 分支的兼容代码。

## system-prompt 调度器适配

`createSystemPromptBuilder` 返回类型改为：

```typescript
(context: SystemPromptContext) => Promise<SystemPrompt>
```

使用 `asSystemPrompt([...])` 包装返回结果。

## 测试与示例更新

所有使用 `systemPrompt: "test"` 的地方改为 `systemPrompt: asSystemPrompt(["test"])`。

`examples/`、`src/cli/`、`src/tui/` 中的 `Agent` 初始化代码需要将 `systemPrompt` 从 `initialState` 中移出，放到顶层并用 `asSystemPrompt` 包装。

## 验证

- `bun tsc --noEmit` 通过
- `bun test src/` 通过
