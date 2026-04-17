# SystemPrompt 统一为 branded `string[]` 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `systemPrompt` 统一为 `SystemPrompt` branded type（`readonly string[]`），修复 `stream-assistant.ts` 中 `config.systemPrompt` 被忽略的 bug，并简化 Anthropic provider 的逻辑。

**Architecture:** 在 `src/core/ai/types.ts` 中引入 `SystemPrompt` branded type 和 `asSystemPrompt` 工厂函数；所有涉及 `systemPrompt` 的类型统一改为 `SystemPrompt`；`AgentOptions` 将 `systemPrompt` 从 `initialState` 中移出放到顶层，支持静态数组或构建函数；`stream-assistant.ts` 改为消费 `config.systemPrompt`；Anthropic provider 删除 `string` 分支兼容代码。

**Tech Stack:** TypeScript, Bun

**规则提醒:** 严格遵循 `.claude/rules/code.md`（Simplicity First、Surgical Changes、Goal-Driven Execution）和 `.claude/rules/typescript.md`（结构体优先用 interface、字段加中文注释）。

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/ai/types.ts` | 修改 | 新增 `SystemPrompt` branded type 和 `asSystemPrompt`，修改 `Context.systemPrompt` |
| `src/agent/types.ts` | 修改 | `AgentContext`、`AgentState`、`AgentLoopConfig` 的 `systemPrompt` 改为 `SystemPrompt` |
| `src/agent/agent.ts` | 修改 | 重构 `AgentOptions` 和 `Agent` 类，`systemPrompt` 移出 `initialState` |
| `src/agent/stream-assistant.ts` | 修改 | 修复 bug：使用 `config.systemPrompt` 代替 `context.systemPrompt` |
| `src/core/ai/providers/anthropic.ts` | 修改 | 简化 `buildParams`，删除 `string` 分支兼容代码 |
| `src/agent/system-prompt/systemPrompt.ts` | 修改 | `createSystemPromptBuilder` 返回 `Promise<SystemPrompt>` |
| `src/agent/__tests__/agent-loop.test.ts` | 修改 | 所有 `systemPrompt: "test"` 改为 `asSystemPrompt(["test"])` |
| `src/agent/__tests__/stream-assistant.test.ts` | 修改 | 同上 |
| `src/agent/__tests__/tool-execution.test.ts` | 修改 | 同上 |
| `src/cli/chat.ts` | 修改 | `systemPrompt` 移出 `initialState`，使用 `asSystemPrompt` |
| `src/tui/hooks/useAgent.ts` | 修改 | 内部将 `string` 包装为 `asSystemPrompt([...])` |
| `examples/agent-math.ts` | 修改 | `systemPrompt` 移出 `initialState`，使用 `asSystemPrompt` |
| `examples/debug-agent-chat.ts` | 修改 | 同上（如存在） |

---

### Task 1: 核心类型层引入 SystemPrompt

**Files:**
- Modify: `src/core/ai/types.ts`

- [ ] **Step 1: 在 `Context` 接口之前添加 `SystemPrompt` 类型定义**

  在 `src/core/ai/types.ts` 中，找到 `export interface Context` 的位置，在其前面插入：

  ```typescript
  export type SystemPrompt = readonly string[] & { readonly __brand: 'SystemPrompt' };

  export function asSystemPrompt(value: readonly string[]): SystemPrompt {
    return value as unknown as SystemPrompt;
  }
  ```

- [ ] **Step 2: 修改 `Context` 接口的 `systemPrompt` 字段**

  将：
  ```typescript
  export interface Context {
    /** 系统提示词 */
    systemPrompt?: string | string[];
    messages: Message[];
    tools?: Tool[];
  }
  ```
  改为：
  ```typescript
  export interface Context {
    /** 系统提示词 */
    systemPrompt?: SystemPrompt;
    messages: Message[];
    tools?: Tool[];
  }
  ```

- [ ] **Step 3: 验证类型检查**

  Run: `bun tsc --noEmit`
  Expected: 会报很多错误（这是预期的，因为其他文件还没改），确认错误都来自 `systemPrompt` 类型不匹配即可

- [ ] **Step 4: Commit**

  ```bash
  git add src/core/ai/types.ts
  git commit -m "types(core): introduce SystemPrompt branded type"
  ```

---

### Task 2: Agent 类型层统一 SystemPrompt

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: 导入 `SystemPrompt`**

  修改 `src/agent/types.ts` 的 import 语句：

  ```typescript
  import type {
    AssistantMessage,
    AssistantMessageEvent,
    ImageContent,
    Message,
    Model,
    SimpleStreamOptions,
    SystemPrompt,
    TextContent,
    ToolResultMessage,
  } from "../core/ai/index.js";
  ```

- [ ] **Step 2: 修改 `AgentContext`、`AgentState`、`AgentLoopConfig`**

  `AgentContext`：
  ```typescript
  export interface AgentContext {
    /** 系统提示词 */
    systemPrompt: SystemPrompt;
    messages: AgentMessage[];
    tools?: AgentTool<any>[];
  }
  ```

  `AgentState`：
  ```typescript
  export interface AgentState {
    /** 系统提示词 */
    systemPrompt: SystemPrompt;
    model: Model<any>;
    // ... 其他不变
  }
  ```

  `AgentLoopConfig`：
  ```typescript
  export interface AgentLoopConfig extends SimpleStreamOptions {
    /** 系统提示词 */
    systemPrompt?: SystemPrompt;
    // ... 其他不变
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/agent/types.ts
  git commit -m "types(agent): unify systemPrompt as SystemPrompt"
  ```

---

### Task 3: Agent 类重构

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: 导入 `SystemPrompt` 和 `asSystemPrompt`**

  修改 `src/agent/agent.ts` 的 import：

  ```typescript
  import {
    type ImageContent,
    type Message,
    type Model,
    type SimpleStreamOptions,
    streamSimple,
    type SystemPrompt,
    type TextContent,
    type ThinkingBudgets,
    type Transport,
    asSystemPrompt,
  } from "../core/ai/index.js";
  ```

- [ ] **Step 2: 修改 `createMutableAgentState` 的默认值**

  将：
  ```typescript
  systemPrompt: initialState?.systemPrompt ?? "",
  ```
  改为：
  ```typescript
  systemPrompt: initialState?.systemPrompt ?? asSystemPrompt([""]),
  ```

- [ ] **Step 3: 重构 `AgentOptions` 接口**

  将 `AgentOptions` 替换为：

  ```typescript
  export interface AgentOptions {
    /** 初始状态 */
    initialState?: Partial<Omit<AgentState, "systemPrompt" | "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
    /** 系统提示词（静态数组或构建函数） */
    systemPrompt?: SystemPrompt | ((context: AgentContext) => Promise<SystemPrompt>);
    /** 将 Agent 消息转换为 LLM 消息格式 */
    convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
    /** 消息转换/过滤函数 */
    transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
    /** 流函数 */
    streamFn?: StreamFn;
    /** 自定义 API Key 获取函数 */
    getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
    /** 载荷回调函数 */
    onPayload?: SimpleStreamOptions["onPayload"];
    /** 工具执行前的钩子 */
    beforeToolCall?: (
      context: BeforeToolCallContext,
      signal?: AbortSignal,
    ) => Promise<BeforeToolCallResult | undefined>;
    /** 工具执行后的钩子 */
    afterToolCall?: (
      context: AfterToolCallContext,
      signal?: AbortSignal,
    ) => Promise<AfterToolCallResult | undefined>;
    /** 引导模式 */
    steeringMode?: QueueMode;
    /** 后续消息模式 */
    followUpMode?: QueueMode;
    /** 会话 ID */
    sessionId?: string;
    /** 思考预算 */
    thinkingBudgets?: ThinkingBudgets;
    /** 传输类型 */
    transport?: Transport;
    /** 最大重试延迟（毫秒） */
    maxRetryDelayMs?: number;
    /** 工具执行模式 */
    toolExecution?: ToolExecutionMode;
  }
  ```

- [ ] **Step 4: 修改 `Agent` 类属性**

  删除：
  ```typescript
  /** 构建 system prompt 的函数 */
  public buildSystemPrompt?: (context: AgentContext) => Promise<string[]>;
  ```

  替换为：
  ```typescript
  /** 系统提示词（静态数组或构建函数） */
  public systemPrompt?: SystemPrompt | ((context: AgentContext) => Promise<SystemPrompt>);
  ```

- [ ] **Step 5: 修改构造函数**

  将 `this._state = createMutableAgentState(options.initialState);` 及其附近替换为：

  ```typescript
  constructor(options: AgentOptions = {}) {
    const staticPrompt =
      typeof options.systemPrompt === "function"
        ? asSystemPrompt([""])
        : options.systemPrompt ?? asSystemPrompt([""]);
    this._state = createMutableAgentState({ ...options.initialState, systemPrompt: staticPrompt });
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = options.transformContext;
    this.streamFn = options.streamFn ?? streamSimple;
    this.getApiKey = options.getApiKey;
    this.systemPrompt = options.systemPrompt;
    this.onPayload = options.onPayload;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    // ... 其余不变
  }
  ```

- [ ] **Step 6: 修改 `createLoopConfig`**

  将方法体替换为：

  ```typescript
  private async createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): Promise<AgentLoopConfig> {
    let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;

    let resolvedSystemPrompt: SystemPrompt;
    if (typeof this.systemPrompt === "function") {
      resolvedSystemPrompt = await this.systemPrompt(this.createContextSnapshot());
      this._state.systemPrompt = resolvedSystemPrompt;
    } else {
      resolvedSystemPrompt = this._state.systemPrompt;
    }

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

- [ ] **Step 7: 验证类型检查**

  Run: `bun tsc --noEmit`
  Expected: 确认 `agent.ts` 本身无类型错误（其他文件报错是预期的）

- [ ] **Step 8: Commit**

  ```bash
  git add src/agent/agent.ts
  git commit -m "feat(agent): move systemPrompt out of initialState, support builder function"
  ```

---

### Task 4: 修复 stream-assistant bug

**Files:**
- Modify: `src/agent/stream-assistant.ts`

- [ ] **Step 1: 修改 `llmContext` 构造逻辑**

  找到 `streamAssistantResponse` 函数中的：
  ```typescript
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: (context.tools ?? []) as Tool[],
  };
  ```

  改为：
  ```typescript
  const llmContext: Context = {
    systemPrompt: config.systemPrompt,
    messages: llmMessages,
    tools: (context.tools ?? []) as Tool[],
  };
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/agent/stream-assistant.ts
  git commit -m "fix(stream-assistant): use config.systemPrompt instead of context.systemPrompt"
  ```

---

### Task 5: 简化 Anthropic Provider

**Files:**
- Modify: `src/core/ai/providers/anthropic.ts`

- [ ] **Step 1: 修改 `buildSystemBlocks` 签名**

  将：
  ```typescript
  function buildSystemBlocks(
    sections: string[],
    cacheControl?: { type: "ephemeral"; ttl?: "1h" },
  ): Anthropic.Messages.TextBlockParam[]
  ```
  改为：
  ```typescript
  function buildSystemBlocks(
    sections: readonly string[],
    cacheControl?: { type: "ephemeral"; ttl?: "1h" },
  ): Anthropic.Messages.TextBlockParam[]
  ```

- [ ] **Step 2: 简化 `buildParams` 中的 systemPrompt 处理**

  找到：
  ```typescript
  if (context.systemPrompt) {
    if (Array.isArray(context.systemPrompt)) {
      params.system = buildSystemBlocks(context.systemPrompt, cacheControl);
    } else {
      params.system = [
        {
          type: "text",
          text: sanitizeSurrogates(context.systemPrompt),
          ...(cacheControl ? { cache_control: cacheControl } : {}),
        },
      ];
    }
  }
  ```

  改为：
  ```typescript
  if (context.systemPrompt) {
    params.system = buildSystemBlocks(context.systemPrompt, cacheControl);
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/core/ai/providers/anthropic.ts
  git commit -m "refactor(anthropic): simplify systemPrompt handling, always array"
  ```

---

### Task 6: 更新 system-prompt 调度器

**Files:**
- Modify: `src/agent/system-prompt/systemPrompt.ts`

- [ ] **Step 1: 导入 `asSystemPrompt` 并修改返回类型**

  在文件顶部添加：
  ```typescript
  import { asSystemPrompt } from "../../core/ai/index.js";
  ```

  将 `createSystemPromptBuilder` 的返回类型：
  ```typescript
  (context: SystemPromptContext) => Promise<string[]>
  ```
  改为：
  ```typescript
  (context: SystemPromptContext) => Promise<SystemPrompt>
  ```

- [ ] **Step 2: 用 `asSystemPrompt` 包装返回值**

  将 `return [...staticValues, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...dynamicValues];` 或等价的返回逻辑改为：
  ```typescript
  return asSystemPrompt([...staticValues, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...dynamicValues]);
  ```

  （如果当前实现已经做了空数组优化，则把最终 `result` 数组包装即可：`return asSystemPrompt(result);`）

- [ ] **Step 3: Commit**

  ```bash
  git add src/agent/system-prompt/systemPrompt.ts
  git commit -m "feat(system-prompt): builder returns SystemPrompt branded type"
  ```

---

### Task 7: 更新测试文件

**Files:**
- Modify: `src/agent/__tests__/agent-loop.test.ts`
- Modify: `src/agent/__tests__/stream-assistant.test.ts`
- Modify: `src/agent/__tests__/tool-execution.test.ts`

- [ ] **Step 1: 更新 `agent-loop.test.ts`**

  在 import 中添加：
  ```typescript
  import { asSystemPrompt } from "../../core/ai/types.js";
  ```

  将 `systemPrompt: "test"` 改为 `systemPrompt: asSystemPrompt(["test"])`（约 8 处）。

- [ ] **Step 2: 更新 `stream-assistant.test.ts`**

  在 import 中添加：
  ```typescript
  import { asSystemPrompt } from "../../core/ai/types.js";
  ```

  将 `systemPrompt: "test"` 改为 `systemPrompt: asSystemPrompt(["test"])`（约 2 处）。

- [ ] **Step 3: 更新 `tool-execution.test.ts`**

  在 import 中添加：
  ```typescript
  import { asSystemPrompt } from "../../core/ai/types.js";
  ```

  将 `systemPrompt: "test"` 改为 `systemPrompt: asSystemPrompt(["test"])`（约 1 处）。

- [ ] **Step 4: 运行测试验证**

  Run: `bun test src/agent/__tests__/agent-loop.test.ts src/agent/__tests__/stream-assistant.test.ts src/agent/__tests__/tool-execution.test.ts`
  Expected: ALL PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/agent/__tests__/
  git commit -m "test(agent): update tests to use SystemPrompt"
  ```

---

### Task 8: 更新 CLI、TUI 和示例

**Files:**
- Modify: `src/cli/chat.ts`
- Modify: `src/tui/hooks/useAgent.ts`
- Modify: `examples/agent-math.ts`
- Modify: `examples/debug-agent-chat.ts`

- [ ] **Step 1: 更新 `src/cli/chat.ts`**

  在 import 中添加：
  ```typescript
  import { asSystemPrompt } from "../core/ai/index.js";
  ```

  将：
  ```typescript
  const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      // ...
    },
    // ...
  });
  ```
  改为：
  ```typescript
  const systemPromptText = process.argv[2] ?? "You are a helpful assistant.";
  const agent = new Agent({
    systemPrompt: asSystemPrompt([systemPromptText]),
    initialState: {
      model,
      // ...
    },
    // ...
  });
  ```

  如果代码中有 `console.log(agent.state.systemPrompt)` 之类的直接输出，改为 `console.log(agent.state.systemPrompt.join("\n\n"))`。

- [ ] **Step 2: 更新 `src/tui/hooks/useAgent.ts`**

  在 import 中添加：
  ```typescript
  import { asSystemPrompt } from "../../core/ai/index.js";
  ```

  将 `useMemo` 中的 `new Agent({ initialState: { systemPrompt: options.systemPrompt, ... } })` 改为：
  ```typescript
  return new Agent({
    systemPrompt: asSystemPrompt([options.systemPrompt]),
    initialState: {
      model: options.model,
      thinkingLevel: "medium",
      tools: options.tools,
    },
    getApiKey: () => options.apiKey,
  });
  ```

- [ ] **Step 3: 更新 `examples/agent-math.ts`**

  在 import 中添加：
  ```typescript
  import { asSystemPrompt } from "../src/core/ai/index.js";
  ```

  将 `initialState` 中的 `systemPrompt: "You are a math assistant..."` 移出，改为顶层：
  ```typescript
  const agent = new Agent({
    systemPrompt: asSystemPrompt(["You are a math assistant..."]),
    initialState: {
      model,
      tools: [addTool, subtractTool],
      thinkingLevel: "off",
    },
    // ...
  });
  ```

- [ ] **Step 4: 更新 `examples/debug-agent-chat.ts`**

  同样方式：将 `systemPrompt` 从 `initialState` 移出，用 `asSystemPrompt([...])` 包装。

- [ ] **Step 5: Commit**

  ```bash
  git add src/cli/chat.ts src/tui/hooks/useAgent.ts examples/
  git commit -m "refactor(cli/tui/examples): adapt to new SystemPrompt API"
  ```

---

### Task 9: 端到端验证

**Files:**
- 无新增文件，只运行验证

- [ ] **Step 1: 运行类型检查**

  Run: `bun tsc --noEmit`
  Expected: PASS（确保所有文件已更新完毕）

- [ ] **Step 2: 运行全部 src 测试**

  Run: `bun test src/`
  Expected: ALL PASS

- [ ] **Step 3: Commit（如全部通过）**

  ```bash
  git commit --allow-empty -m "test: verify SystemPrompt refactor passes all checks"
  ```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `SystemPrompt` branded type → Task 1
  - `AgentContext`/`AgentState`/`AgentLoopConfig` 统一 → Task 2
  - `AgentOptions.systemPrompt` 顶层化 → Task 3
  - `stream-assistant.ts` bug 修复 → Task 4
  - Anthropic provider 简化 → Task 5
  - `system-prompt` builder 适配 → Task 6
  - 测试更新 → Task 7
  - CLI/TUI/示例更新 → Task 8
  - 端到端验证 → Task 9

- [x] **Placeholder scan:** 无 TBD、TODO、implement later。所有步骤包含具体代码和命令。

- [x] **Type一致性：**
  - `SystemPrompt` 在 Task 1 定义，后续任务一致使用
  - `asSystemPrompt([...])` 在测试、示例、调度器中统一使用
  - `AgentOptions` 中移除了 `buildSystemPrompt`，统一为 `systemPrompt`
