# 从 AgentState 移除 SystemPrompt 并统一为函数 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **TDD 要求：** 每一步严格遵循 Red-Green-Refactor 循环。每改一行代码，立即运行测试/类型检查验证。

**Goal:** 从 `AgentState` 和 `AgentContext` 中移除 `systemPrompt`，将 `AgentOptions.systemPrompt` 统一为函数签名，简化 `Agent` 内部逻辑，并删除 CLI `/system` 命令。

**Architecture:** `AgentState` 只保留真正的运行时状态（model、messages、tools、isStreaming 等），`systemPrompt` 明确为 loop 配置输入；`Agent` 构造函数归一化保存函数引用，`createLoopConfig` 统一 `await` 调用，不再写入 `_state`。

**Tech Stack:** TypeScript, Bun

**规则提醒:** 严格遵循 `.claude/rules/code.md`（Simplicity First、Surgical Changes、Goal-Driven Execution）和 `.claude/rules/typescript.md`（结构体优先用 interface、字段加中文注释）。

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/agent/types.ts` | 修改 | `AgentContext`、`AgentState` 删除 `systemPrompt` |
| `src/agent/agent.ts` | 修改 | `createMutableAgentState` 移除 `systemPrompt`，`AgentOptions.systemPrompt` 统一为函数，`createLoopConfig` 统一 await |
| `src/agent/__tests__/agent-loop.test.ts` | 修改 | 测试移除 `systemPrompt`，通过 `config` 传入 |
| `src/agent/__tests__/stream-assistant.test.ts` | 修改 | 同上 |
| `src/agent/__tests__/tool-execution.test.ts` | 修改 | 同上 |
| `src/cli/chat.ts` | 修改 | 删除 `/system` 命令，使用函数式 `systemPrompt` |
| `src/tui/hooks/useAgent.ts` | 修改 | 使用函数式 `systemPrompt` |
| `examples/agent-math.ts` | 修改 | 使用函数式 `systemPrompt` |
| `examples/debug-agent-chat.ts` | 修改 | 使用函数式 `systemPrompt` |

---

### Task 1: 修改 Agent 类型定义（Red 阶段）

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: 让类型检查先变红**

  修改 `src/agent/types.ts`：

  1. `AgentContext` 删除 `systemPrompt`：
     ```typescript
     export interface AgentContext {
       messages: AgentMessage[];
       tools?: AgentTool<any>[];
     }
     ```

  2. `AgentState` 删除 `systemPrompt`：
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

- [ ] **Step 2: 运行类型检查确认 Red**

  Run: `bun tsc --noEmit`
  Expected: 大量编译错误（`agent.ts`、测试、CLI、TUI 等），确认错误来源都是 `systemPrompt` 被移除即可。

- [ ] **Step 3: Commit Red 状态**

  ```bash
  git add src/agent/types.ts
  git commit -m "types(agent): remove systemPrompt from AgentState and AgentContext"
  ```

---

### Task 2: 重构 Agent 类（Green 阶段）

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: 修复 `createMutableAgentState` 默认值**

  将：
  ```typescript
  systemPrompt: initialState?.systemPrompt ?? asSystemPrompt([""]),
  ```
  删除。`createMutableAgentState` 的返回值不再包含 `systemPrompt`。

  同时修改 `createMutableAgentState` 的签名：
  ```typescript
  function createMutableAgentState(
    initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>,
  ): MutableAgentState
  ```

  以及 `MutableAgentState` 类型定义，删除其中的 `systemPrompt`。

- [ ] **Step 2: 修改 `AgentOptions.systemPrompt` 为纯函数**

  ```typescript
  export interface AgentOptions {
    initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
    /** 系统提示词构建函数 */
    systemPrompt?: (context: AgentContext) => Promise<SystemPrompt>;
    // ... 其他字段不变
  }
  ```

- [ ] **Step 3: 修改 `Agent` 类属性**

  将：
  ```typescript
  /** 系统提示词（静态数组或构建函数） */
  public systemPrompt?: SystemPrompt | ((context: AgentContext) => Promise<SystemPrompt>);
  ```
  改为：
  ```typescript
  /** 系统提示词构建函数 */
  public systemPrompt: (context: AgentContext) => Promise<SystemPrompt>;
  ```

- [ ] **Step 4: 修改构造函数**

  将构造函数中的相关逻辑替换为：
  ```typescript
  constructor(options: AgentOptions = {}) {
    this._state = createMutableAgentState(options.initialState);
    this.systemPrompt = options.systemPrompt ?? (async () => asSystemPrompt([""]));
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    // ... 其余字段赋值不变
  }
  ```

- [ ] **Step 5: 修改 `createLoopConfig` 简化逻辑**

  将方法体替换为：
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

- [ ] **Step 6: 修改 `createContextSnapshot`**

  删除 `systemPrompt`：
  ```typescript
  private createContextSnapshot(): AgentContext {
    return {
      messages: this._state.messages.slice(),
      tools: this._state.tools.slice(),
    };
  }
  ```

- [ ] **Step 7: 运行类型检查确认 Green**

  Run: `bun tsc --noEmit`
  Expected: `agent.ts` 本身无错误（其余文件报错是预期的）

- [ ] **Step 8: Commit Green 状态**

  ```bash
  git add src/agent/agent.ts
  git commit -m "feat(agent): unify systemPrompt as function, remove from state"
  ```

---

### Task 3: 更新测试文件（TDD 循环）

**Files:**
- Modify: `src/agent/__tests__/agent-loop.test.ts`
- Modify: `src/agent/__tests__/stream-assistant.test.ts`
- Modify: `src/agent/__tests__/tool-execution.test.ts`

- [ ] **Step 1: 更新 `agent-loop.test.ts`**

  1. 所有 `createMockContext` / inline `AgentContext` 对象删除 `systemPrompt` 字段。
  2. 将 `systemPrompt` 放到 `AgentLoopConfig` 中传入（因为 loop config 仍需要它）：
     ```typescript
     import { asSystemPrompt } from "../../core/ai/types.js";
     
     const config: AgentLoopConfig = {
       model: createMockModel(),
       convertToLlm: (m: any[]) => m as Message[],
       systemPrompt: asSystemPrompt(["test"]),
     } as any;
     ```
  3. 检查并删除所有 `expect(context.systemPrompt)` 或类似断言。

- [ ] **Step 2: 更新 `stream-assistant.test.ts`**

  1. `createMockContext()` 删除 `systemPrompt`。
  2. `createMockConfig()` 添加 `systemPrompt: asSystemPrompt(["test"])`。
  3. 删除 `asSystemPrompt` 的 import（如果该文件不再需要）。

- [ ] **Step 3: 更新 `tool-execution.test.ts`**

  1. `createMockContext()` 删除 `systemPrompt`。
  2. 如有 `AgentLoopConfig` 需要 `systemPrompt`，则添加 `systemPrompt: asSystemPrompt(["test"])`。

- [ ] **Step 4: 运行测试验证**

  Run: `bun test src/agent/__tests__/agent-loop.test.ts src/agent/__tests__/stream-assistant.test.ts src/agent/__tests__/tool-execution.test.ts`
  Expected: ALL PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/agent/__tests__/
  git commit -m "test(agent): adapt tests to state-less systemPrompt"
  ```

---

### Task 4: 更新 CLI、TUI 和示例

**Files:**
- Modify: `src/cli/chat.ts`
- Modify: `src/tui/hooks/useAgent.ts`
- Modify: `examples/agent-math.ts`
- Modify: `examples/debug-agent-chat.ts`

- [ ] **Step 1: 更新 `src/cli/chat.ts`**

  1. `Agent` 初始化改为函数形式：
     ```typescript
     const systemPromptText = process.argv[2] ?? "You are a helpful assistant.";
     const agent = new Agent({
       systemPrompt: async () => asSystemPrompt([systemPromptText]),
       initialState: {
         model,
         // ...
       },
       getApiKey: () => apiKey,
     });
     ```
  2. 删除 `/system` 分支：
     ```typescript
     // 删除这一行
     if (input === "/system") { console.log(agent.state.systemPrompt.join("\n\n")); rl.prompt(); return; }
     ```

- [ ] **Step 2: 更新 `src/tui/hooks/useAgent.ts`**

  ```typescript
  return new Agent({
    systemPrompt: async () => asSystemPrompt([options.systemPrompt]),
    initialState: {
      model: options.model,
      thinkingLevel: "medium",
      tools: options.tools,
    },
    getApiKey: () => options.apiKey,
  });
  ```

- [ ] **Step 3: 更新 `examples/agent-math.ts`**

  ```typescript
  const agent = new Agent({
    systemPrompt: async () =>
      asSystemPrompt([
        "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
      ]),
    initialState: {
      model,
      tools: [addTool, subtractTool],
      thinkingLevel: "off",
    },
    getApiKey: () => process.env.MINIMAX_API_KEY,
  });
  ```

- [ ] **Step 4: 更新 `examples/debug-agent-chat.ts`**

  同理：将 `systemPrompt` 改为 `async () => asSystemPrompt(["..."])`，从 `initialState` 中移除。

- [ ] **Step 5: 运行类型检查**

  Run: `bun tsc --noEmit`
  Expected: PASS（确认 CLI/TUI/examples 无编译错误）

- [ ] **Step 6: Commit**

  ```bash
  git add src/cli/chat.ts src/tui/hooks/useAgent.ts examples/
  git commit -m "refactor(cli/tui/examples): use function-only systemPrompt API"
  ```

---

### Task 5: 端到端验证

**Files:**
- 无新增文件，只运行验证

- [ ] **Step 1: 运行类型检查**

  Run: `bun tsc --noEmit`
  Expected: PASS

- [ ] **Step 2: 运行全部 src 测试**

  Run: `bun test src/`
  Expected: ALL PASS

- [ ] **Step 3: 运行 examples 验证**

  Run: `bun run examples/agent-math.ts`
  Expected: 正常执行，调用 tools，输出正确结果

  Run: `bun run examples/debug-agent-chat.ts`
  Expected: 正常执行，完成 3 个 prompt

- [ ] **Step 4: Commit（如全部通过）**

  ```bash
  git commit --allow-empty -m "test: verify state-less systemPrompt refactor passes all checks"
  ```

---

## TDD 执行原则（必读）

1. **每一步只做一件事**：改一个文件、改一个函数、改一行类型定义。
2. **每次改动后必须验证**：`bun tsc --noEmit` 或 `bun test <file>`。
3. **Red 阶段允许失败**：Task 1 改完类型后，编译报错是预期的。
4. **Green 阶段必须清零**：当前 Task 负责的代码必须无编译错误、测试通过，才能 commit。
5. **不跨 Task 修 bug**：如果测试失败来自未修改的文件，记录但不在当前 Task 修复。

## Self-Review Checklist

- [x] **Spec coverage:** 类型移除 → Task 1；Agent 重构 → Task 2；测试更新 → Task 3；CLI/TUI/示例 → Task 4；验证 → Task 5。
- [x] **Placeholder scan:** 无 TBD、TODO、implement later。
- [x] **Type一致性:** `systemPrompt` 统一为 `(context: AgentContext) => Promise<SystemPrompt>`，不再存在于 `AgentState` / `AgentContext` 中。
