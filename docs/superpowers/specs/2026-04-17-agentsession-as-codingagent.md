# AgentSession 作为 CodingAgent 内置 system prompt

## 目标

将 `AgentSession` 明确为 `CodingAgent` 的产品层抽象，内置 cc 风格的 coding-agent system prompt 作为默认行为。`systemPrompt` 变为可选覆盖字段。

同时废弃 CLI 入口，将 `agent-math.ts` 回归底层 `Agent` 以演示自定义能力。

## 架构

### AgentSession = CodingAgent

`AgentSession` 构造函数中：
- **不传 `systemPrompt`** → 自动使用内置的 `createSystemPromptBuilder([intro, system, doingTasks, actions, usingYourTools, envInfo, outputEfficiency, toneAndStyle, summarizeToolResults, sessionSpecificGuidance])`
- **传了 `systemPrompt`** → 使用自定义的（如特殊场景覆写）

### 文件职责

| 文件 | 职责 |
|------|------|
| `src/agent/session.ts` | `CodingAgent` 产品层，内置默认 system prompt |
| `src/agent/system-prompt/coding-agent.ts` | 组装所有 section，导出 builder 函数 |
| `src/tui/app.tsx` | TUI 入口，直接 `new AgentSession({...})`，不传 systemPrompt |
| `examples/debug-agent-chat.ts` | 调试示例，直接 `new AgentSession({...})` |
| `examples/agent-math.ts` | 回归底层 `Agent`，演示自定义 tools + systemPrompt |

### 删除项

- `src/cli/chat.ts`（废弃 CLI 入口）
- `src/cli/__tests__/chat-pipe.test.ts`
- `src/cli/format.ts` 保留（`debug-agent-chat.ts` 仍复用）

## 变更清单

### 1. 新增 coding-agent builder

**`src/agent/system-prompt/coding-agent.ts`**
- 导入所有 section 的 `compute` 函数
- 按 static/dynamic 分类组装 `SystemPromptSection[]`
- 导出 `buildCodingAgentSystemPrompt(context)` 函数

### 2. AgentSession 内置默认 system prompt

**`src/agent/session.ts`**
- `systemPrompt?: (context) => Promise<SystemPrompt>` 变为可选
- 构造函数中：未传则使用 `buildCodingAgentSystemPrompt`

### 3. TUI 简化

**`src/tui/app.tsx`**
- 删除 `const systemPrompt = process.argv[2] ?? "..."`
- 删除 `systemPrompt` 参数传递

**`src/tui/hooks/useAgent.ts`**
- `UseAgentOptions` 中删除 `systemPrompt` 字段
- `useMemo` 中不传 `systemPrompt`

### 4. debug-agent-chat.ts 简化

**`examples/debug-agent-chat.ts`**
- 删除 `systemPrompt` 参数
- 直接 `new AgentSession({ cwd, model, apiKey })`

### 5. agent-math.ts 回归底层 Agent

**`examples/agent-math.ts`**
- 从 `AgentSession` 改回 `Agent`
- 使用 `agent.subscribe()` 订阅 `AgentEvent`
- 自行管理 `systemPrompt` 和 tools

### 6. 删除废弃 CLI

- 删除 `src/cli/chat.ts`
- 删除 `src/cli/__tests__/chat-pipe.test.ts`

## 验证

- `bun tsc --noEmit` 通过
- `bun test src/` 通过（83 tests）
- `bun run examples/debug-agent-chat.ts` 输出正常
- `bun run examples/agent-math.ts` 输出正常
