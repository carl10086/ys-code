# AgentSession 设计文档

## 背景与目标

当前 `ys-code` 的 CLI (`src/cli/chat.ts`) 和 TUI (`src/tui/hooks/useAgent.ts`) 都直接与底层 `Agent` 交互，导致两处重复实现了大量 UI 状态管理逻辑（如 `turnStartTime`、`toolStartTimes`、`hasEmittedThinking` 等）。

引入 `AgentSession` 层的目标：
1. **提供统一的 UI 接入层**：CLI 和 TUI 共享同一套 UI 友好型事件抽象，不再直接处理 `AgentEvent` 的流式细节。
2. **集成 `systemPrompt` 构建器**：`AgentSession` 持有 `cwd`，负责在每次运行前调用 `createSystemPromptBuilder` 生成 `SystemPrompt`，让 `Agent` 层不再感知 `cwd`、工具描述等外部上下文。

## 设计原则

- **轻量聚焦**：不像 `pi-mono` 的 `AgentSession` 那样承担 compaction、auto-retry、settings 等职责，只聚焦 UI 事件转换和 `systemPrompt` 桥接。
- **UI 原生事件**：将底层 `AgentEvent` 转换为 UI 层可直接消费的事件，消除 CLI/TUI 中的重复状态管理。
- **向后兼容**：`Agent` 核心引擎保持不变，`AgentSession` 只是其上层包装。

## 架构概览

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│      CLI        │     │      TUI        │     │   其他入口点     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────┐
                    │    AgentSession     │
                    │  (UI 事件 + prompt) │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │       Agent         │
                    │   (核心推理引擎)     │
                    └─────────────────────┘
```

## AgentSessionEvent 设计

不同于 `pi-mono` 选择扩展原始 `AgentEvent`，`ys-code` 的 `AgentSessionEvent` 直接转换为 UI 层需要的事件类型：

```typescript
export type AgentSessionEvent =
  | { type: "turn_start"; modelName: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string; timeMs: number }
  | { type: "turn_end"; tokens: number; cost: number; timeMs: number; errorMessage?: string }
  | { type: "queue_update"; steeringCount: number; followUpCount: number };
```

**设计理由**：
- CLI 和 TUI 当前都需要在订阅者内部维护 `hasEmittedThinking`、`turnStartTime`、`toolStartTimes` 等状态，以便将原始 `AgentEvent` 转换为可渲染的输出。
- 通过将这些转换逻辑上移到 `AgentSession`，CLI/TUI 的代码量可大幅减少，且行为更容易保持一致。

## AgentSession API

```typescript
export interface AgentSessionOptions {
  /** 当前工作目录 */
  cwd: string;
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
  /** 思考级别 */
  thinkingLevel?: ThinkingLevel;
}

export class AgentSession {
  constructor(options: AgentSessionOptions);

  /** 发送用户消息，启动新一轮对话 */
  prompt(text: string): Promise<void>;

  /** 在当前 assistant turn 结束后注入引导消息 */
  steer(text: string): void;

  /** 在 agent 完全空闲后注入后续消息 */
  followUp(text: string): void;

  /** 订阅 UI 事件 */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;

  /** 重置会话状态（清空消息、队列等） */
  reset(): void;

  /** 中止当前运行 */
  abort(): void;

  /** 等待当前运行完全结束 */
  waitForIdle(): Promise<void>;

  /** 当前消息列表（只读） */
  get messages(): readonly AgentMessage[];

  /** 是否正在流式输出 */
  get isStreaming(): boolean;

  /** 当前使用的模型 */
  get model(): Model<any>;
}
```

### systemPrompt 集成

`AgentSession` 内部通过 `createSystemPromptBuilder` 创建 system prompt 构建器。在每次调用 `agent.prompt()` 或 `agent.continue()` 之前，`AgentSession` 会先构建最新的 `SystemPrompt`，并将其设置到 `Agent` 的 `systemPrompt` 属性上。

核心逻辑（伪代码）：

```typescript
private async refreshSystemPrompt(): Promise<void> {
  const context: SystemPromptContext = {
    cwd: this.cwd,
    tools: this.agent.state.tools,
    model: this.agent.state.model,
  };
  const prompt = await this.systemPromptBuilder(context);
  this.agent.systemPrompt = async () => prompt;
}
```

### 工具绑定

`AgentSession` 根据 `cwd` 自动初始化标准工具集（`read`、`write`、`edit`、`bash`），并注入到 `Agent` 的 `tools` 中。这些工具与 `cwd` 绑定，因此 `Agent` 本身不需要知道 `cwd`。

## CLI / TUI 迁移效果

### CLI (`src/cli/chat.ts`)

迁移后：
- 删除 `turnStartTime`、`toolStartTimes`、`hasEmittedThinking`、`hasEmittedAnswer`、`hasEmittedTools` 等状态。
- `agent.subscribe(...)` 替换为 `session.subscribe(...)`，事件处理直接映射到 `format*` 函数。
- `TurnFormatter` 类（或等价的格式化状态管理）可以移除。

### TUI (`src/tui/hooks/useAgent.ts`)

迁移后：
- `useAgent` 内部创建 `AgentSession` 而非直接使用 `Agent`。
- 删除 `toolStartTimes` ref 和 `turnStartTime` ref。
- `setMessages((prev) => ...)` 中的复杂状态更新简化为对 `AgentSessionEvent` 的直接映射。

## 依赖关系

- `AgentSession` 依赖于：
  - `Agent`（核心引擎）
  - `createSystemPromptBuilder`（`src/agent/system-prompt/systemPrompt.ts`）
  - `SystemPromptContext`（`src/agent/system-prompt/types.ts`）
  - 标准工具创建函数（`src/agent/tools/index.ts`）
  - `Model`、`SystemPrompt` 等类型（`src/core/ai/index.ts`）

- CLI 和 TUI 将直接依赖于 `AgentSession`，不再直接依赖 `Agent`。

## 文件变更计划

### 新增
- `src/agent/session.ts` — `AgentSession` 类及 `AgentSessionEvent` 类型定义

### 修改
- `src/cli/chat.ts` — 使用 `AgentSession` 替代 `Agent`
- `src/tui/hooks/useAgent.ts` — 使用 `AgentSession` 替代 `Agent`

### 不变
- `src/agent/agent.ts` — `Agent` 核心引擎不做修改
- `src/agent/system-prompt/systemPrompt.ts` — 构建器逻辑不做修改
