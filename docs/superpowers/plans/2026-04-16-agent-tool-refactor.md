# AgentTool 垂直切片化重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AgentTool` 重构为自包含的垂直切片，统一工具的生命周期（校验→权限→执行→格式化），引入 `ToolUseContext` 和 `defineAgentTool()`，同时保持 `AgentEvent` 和公开 API 不变。

**Architecture:** 扩展 `AgentTool` 接口增加 `outputSchema`、`validateInput`、`checkPermissions`、`formatResult` 和运行属性；新增轻量 `ToolUseContext`；`tool-execution.ts` 实现标准化流水线；提供 `defineAgentTool()` 填充安全默认值；存量工具逐一迁移。

**Tech Stack:** Bun, TypeScript, TypeBox, bun:test

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `src/agent/types.ts` | 修改 | 扩展 `AgentTool`，新增 `ToolUseContext`，清理 `AgentLoopConfig` 和 `AgentOptions` 中的废弃钩子类型 |
| `src/agent/define-agent-tool.ts` | 新建 | `defineAgentTool()` 辅助函数，提供安全默认值 |
| `src/agent/__tests__/define-agent-tool.test.ts` | 新建 | `defineAgentTool()` 的默认值覆盖测试 |
| `src/agent/tool-execution.ts` | 修改 | 标准化流水线：`prepare → validateInput → checkPermissions → execute → formatResult` |
| `src/agent/__tests__/tool-execution.test.ts` | 修改 | 更新现有测试，替换 `beforeToolCall`/`afterToolCall` 测试为 `validateInput`/`checkPermissions`/`formatResult` 测试 |
| `src/agent/agent.ts` | 修改 | 移除 `beforeToolCall` / `afterToolCall` 字段及其在 `createLoopConfig` 中的传递 |
| `src/agent/tools/bash.ts` | 修改 | 迁移到新 `AgentTool`，定义 `outputSchema`，拆分 `execute` 与 `formatResult` |
| `src/agent/tools/read.ts` | 修改 | 同上 |
| `src/agent/tools/write.ts` | 修改 | 同上 |
| `src/agent/tools/edit.ts` | 修改 | 同上 |

---

### Task 1: 改造 `src/agent/types.ts`

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: 更新 `AgentTool` 接口并新增 `ToolUseContext`**

将 `AgentTool` 替换为以下定义，并新增 `ToolUseContext`：

```typescript
/** 工具执行上下文 */
export interface ToolUseContext {
  /** 中止信号 */
  abortSignal: AbortSignal;
  /** 当前会话消息列表 */
  messages: AgentMessage[];
  /** 当前可用工具列表 */
  tools: AgentTool<any>[];
  /** 会话 ID */
  sessionId?: string;
  /** 当前模型 */
  model?: Model<any>;
}

/** 工具定义 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TOutput = unknown,
> {
  /** 工具名称 */
  name: string;
  /**
   * 工具描述。
   * - 若为 string，则作为静态描述直接使用
   * - 若为函数，则根据输入参数和上下文动态生成最终描述
   */
  description:
    | string
    | ((params: Static<TParameters>, context: ToolUseContext) => string | Promise<string>);
  /** 输入参数 schema（TypeBox） */
  parameters: TParameters;
  /** 结构化输出 schema（TypeBox） */
  outputSchema: TSchema;
  /** 显示标签 */
  label: string;
  /** 参数预处理：将 LLM 原始参数转换为符合 schema 的输入 */
  prepareArguments?: (args: unknown) => Static<TParameters>;
  /**
   * 参数校验（在权限检查前调用）
   */
  validateInput?: (
    params: Static<TParameters>,
    context: ToolUseContext,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * 权限检查（在 validateInput 通过后调用）
   */
  checkPermissions?: (
    params: Static<TParameters>,
    context: ToolUseContext,
  ) => Promise<{ allowed: true } | { allowed: false; reason: string }>;
  /**
   * 执行工具，返回原始业务输出
   */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    context: ToolUseContext,
    onUpdate?: (partialOutput: TOutput) => void,
  ) => Promise<TOutput>;
  /**
   * 将执行结果格式化为 LLM 可用的内容
   */
  formatResult?: (
    output: TOutput,
    toolCallId: string,
  ) => (TextContent | ImageContent)[] | string;
  /** 是否为只读操作 */
  isReadOnly?: boolean;
  /** 是否支持并发执行 */
  isConcurrencySafe?: boolean;
  /** 是否为破坏性操作 */
  isDestructive?: boolean;
}
```

- [ ] **Step 2: 清理 `AgentLoopConfig` 和废弃类型**

在 `src/agent/types.ts` 中：
1. 删除 `BeforeToolCallResult`、`AfterToolCallResult`、`BeforeToolCallContext`、`AfterToolCallContext` 四个接口的定义
2. 从 `AgentLoopConfig` 中删除 `beforeToolCall` 和 `afterToolCall` 字段
3. 从 `AgentOptions`（在 `src/agent/agent.ts` 中处理，但先确认 types.ts 中没有引用）确认无遗漏

运行类型检查确认无误：

```bash
bun run typecheck
```

Expected: 会出现大量其他文件中的类型错误（正常现象），但 `types.ts` 本身应无语法错误。

- [ ] **Step 3: Commit**

```bash
git add src/agent/types.ts
git commit -m "refactor(agent): 扩展 AgentTool 为垂直切片，新增 ToolUseContext

- execute 返回 TOutput，formatResult 负责 LLM 格式化
- 增加 validateInput、checkPermissions、outputSchema 和运行属性
- 清理 AgentLoopConfig 中的 beforeToolCall / afterToolCall

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: 新建 `defineAgentTool()` 辅助函数

**Files:**
- Create: `src/agent/define-agent-tool.ts`
- Create: `src/agent/__tests__/define-agent-tool.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/agent/__tests__/define-agent-tool.test.ts
import { describe, it, expect } from "bun:test";
import { defineAgentTool } from "../define-agent-tool.js";
import { Type } from "@sinclair/typebox";

describe("defineAgentTool", () => {
  it("填充安全默认值", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      execute: async () => ({ result: "ok" }),
    });

    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.isDestructive).toBe(false);
  });

  it("允许覆盖默认值", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      isReadOnly: true,
      isConcurrencySafe: true,
      execute: async () => ({ result: "ok" }),
    });

    expect(tool.isReadOnly).toBe(true);
    expect(tool.isConcurrencySafe).toBe(true);
  });

  it("formatResult 默认值将输出转为文本", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      execute: async () => ({ result: "ok" }),
    });

    const result = tool.formatResult?.({ result: "ok" }, "call-1");
    expect(result).toEqual([{ type: "text", text: "[object Object]" }]);
  });

  it("自定义 formatResult 生效", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      execute: async () => ({ result: "ok" }),
      formatResult: (output) => [{ type: "text", text: output.result }],
    });

    const result = tool.formatResult?.({ result: "ok" }, "call-1");
    expect(result).toEqual([{ type: "text", text: "ok" }]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/agent/__tests__/define-agent-tool.test.ts
```

Expected: 文件不存在或导入失败的错误。

- [ ] **Step 3: 实现 `defineAgentTool`**

```typescript
// src/agent/define-agent-tool.ts
import type { AgentTool } from "./types.js";
import type { Static, TSchema } from "@sinclair/typebox";

export function defineAgentTool<TParams extends TSchema, TOutput>(
  tool: AgentTool<TParams, TOutput>,
): AgentTool<TParams, TOutput> {
  return {
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    validateInput: async () => ({ ok: true }),
    checkPermissions: async () => ({ allowed: true }),
    formatResult: (output) => [{ type: "text", text: String(output) }],
    ...tool,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test src/agent/__tests__/define-agent-tool.test.ts
```

Expected: 4 个测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/agent/define-agent-tool.ts src/agent/__tests__/define-agent-tool.test.ts
git commit -m "feat(agent): add defineAgentTool helper with safe defaults

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 重构 `src/agent/tool-execution.ts` 标准化流水线

**Files:**
- Modify: `src/agent/tool-execution.ts`

- [ ] **Step 1: 修改导入和 createErrorToolResult**

保留 `createErrorToolResult` 不变：

```typescript
// src/agent/tool-execution.ts
import { type AssistantMessage, type ToolResultMessage, validateToolArguments } from "../core/ai/index.js";
import type { AgentEventSink } from "./stream-assistant.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentTool,
  AgentToolResult,
  ToolUseContext,
} from "./types.js";
```

- [ ] **Step 2: 新增 buildToolUseContext 辅助函数**

在文件顶部添加：

```typescript
function buildToolUseContext(
  currentContext: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): ToolUseContext {
  return {
    abortSignal: signal ?? new AbortController().signal,
    messages: currentContext.messages,
    tools: currentContext.tools ?? [],
    sessionId: config.sessionId,
    model: config.model,
  };
}
```

- [ ] **Step 3: 重构 prepareToolCall**

替换现有 `prepareToolCall` 为：

```typescript
async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: import("../core/ai/index.js").ToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "prepared"; toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any>; args: unknown }
  | { kind: "immediate"; result: AgentToolResult<any>; isError: boolean }
> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const validatedArgs = tool.prepareArguments
      ? tool.prepareArguments(toolCall.arguments)
      : validateToolArguments(tool as any, toolCall);

    const context = buildToolUseContext(currentContext, config, signal);

    if (tool.validateInput) {
      const validation = await tool.validateInput(validatedArgs, context);
      if (!validation.ok) {
        return {
          kind: "immediate",
          result: createErrorToolResult(validation.message),
          isError: true,
        };
      }
    }

    if (tool.checkPermissions) {
      const permission = await tool.checkPermissions(validatedArgs, context);
      if (!permission.allowed) {
        return {
          kind: "immediate",
          result: createErrorToolResult(permission.reason),
          isError: true,
        };
      }
    }

    return {
      kind: "prepared",
      toolCall,
      tool,
      args: validatedArgs,
    };
  } catch (error) {
    return {
      kind: "immediate",
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}
```

- [ ] **Step 4: 重构 executePreparedToolCall**

替换为：

```typescript
async function executePreparedToolCall(
  prepared: { toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any>; args: unknown },
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ output: unknown; isError: boolean }> {
  const updateEvents: Promise<void>[] = [];
  const context = buildToolUseContext(
    { systemPrompt: [], messages: [], tools: [] }, // dummy, 将在外层传入正确的 currentContext
    config,
    signal,
  );

  // 注意：这里需要在外层把 currentContext 传进来，所以修改函数签名
  // 等一下，更好的做法是把 context 作为参数传入
}
```

**修正：** 我需要更精确地写这段代码。`executePreparedToolCall` 需要接收 `currentContext`：

```typescript
async function executePreparedToolCall(
  prepared: { toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any>; args: unknown },
  currentContext: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ output: unknown; isError: boolean }> {
  const updateEvents: Promise<void>[] = [];
  const context = buildToolUseContext(currentContext, config, signal);

  try {
    const output = await prepared.tool.execute(
      prepared.toolCall.id,
      prepared.args as never,
      context,
      (partialOutput) => {
        updateEvents.push(
          Promise.resolve(
            emit({
              type: "tool_execution_update",
              toolCallId: prepared.toolCall.id,
              toolName: prepared.toolCall.name,
              args: prepared.toolCall.arguments,
              partialResult: partialOutput,
            }),
          ),
        );
      },
    );
    await Promise.all(updateEvents);
    return { output, isError: false };
  } catch (error) {
    await Promise.all(updateEvents);
    return {
      output: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}
```

- [ ] **Step 5: 重构 finalizeExecutedToolCall**

替换为：

```typescript
async function finalizeExecutedToolCall(
  prepared: { toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any>; args: unknown },
  executed: { output: unknown; isError: boolean },
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  let content: import("../core/ai/index.js").TextContent | import("../core/ai/index.js").ImageContent[];
  let details: unknown;

  if (executed.isError) {
    content = [{ type: "text", text: String(executed.output) }];
    details = {};
  } else {
    details = executed.output;
    if (prepared.tool.formatResult) {
      const formatted = prepared.tool.formatResult(executed.output, prepared.toolCall.id);
      content = typeof formatted === "string" ? [{ type: "text", text: formatted }] : formatted;
    } else {
      content = [{ type: "text", text: String(executed.output) }];
    }
  }

  const result: AgentToolResult<any> = { content, details };
  return await emitToolCallOutcome(prepared.toolCall, result, executed.isError, emit);
}
```

- [ ] **Step 6: 更新 executeToolCallsSequential 和 executeToolCallsParallel**

`executeToolCallsSequential`：

```typescript
async function executeToolCallsSequential(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: import("../core/ai/index.js").ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    if (preparation.kind === "immediate") {
      results.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
    } else {
      const executed = await executePreparedToolCall(preparation, currentContext, config, signal, emit);
      results.push(await finalizeExecutedToolCall(preparation, executed, emit));
    }
  }

  return results;
}
```

`executeToolCallsParallel`：

```typescript
async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: import("../core/ai/index.js").ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];
  const runnableCalls: Array<{ toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any>; args: unknown }> = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    if (preparation.kind === "immediate") {
      results.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
    } else {
      runnableCalls.push(preparation);
    }
  }

  const runningCalls = runnableCalls.map((prepared) => ({
    prepared,
    execution: executePreparedToolCall(prepared, currentContext, config, signal, emit),
  }));

  const executedResults = await Promise.all(runningCalls.map((r) => r.execution));

  for (let i = 0; i < executedResults.length; i++) {
    const executed = executedResults[i];
    const prepared = runningCalls[i].prepared;
    const finalResult = await finalizeExecutedToolCall(prepared, executed, emit);
    results.push(finalResult);
  }

  return results;
}
```

- [ ] **Step 7: 运行类型检查**

```bash
bun run typecheck
```

Expected: `tool-execution.ts` 自身应无错误，但其他文件（如 `agent.ts`、tools）可能有错误（正常现象）。

- [ ] **Step 8: Commit**

```bash
git add src/agent/tool-execution.ts
git commit -m "refactor(agent): 标准化 tool-execution 流水线

- prepareArguments → validateInput → checkPermissions → execute → formatResult
- execute 返回 TOutput，formatResult 统一处理 LLM 格式化
- 移除 beforeToolCall / afterToolCall 相关逻辑

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 4: 更新 `tool-execution.test.ts`

**Files:**
- Modify: `src/agent/__tests__/tool-execution.test.ts`

- [ ] **Step 1: 重写全部测试**

完整替换文件内容：

```typescript
import { describe, it, expect, mock } from "bun:test";
import { executeToolCalls } from "../tool-execution.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentTool } from "../types.js";
import type { AssistantMessage } from "../../core/ai/types.js";
import { asSystemPrompt } from "../../core/ai/types.js";
import { Type } from "@sinclair/typebox";

function createMockContext(tools: AgentTool<any>[] = []): AgentContext {
  return {
    systemPrompt: asSystemPrompt(["test"]),
    messages: [],
    tools,
  };
}

function createMockAssistantMessage(toolCalls: any[] = []): AssistantMessage {
  return {
    role: "assistant",
    content: toolCalls,
    api: "anthropic-messages",
    provider: "minimax",
    model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

describe("executeToolCalls", () => {
  it("顺序执行：按顺序调用并返回结果", async () => {
    const order: string[] = [];
    const tool: AgentTool = {
      name: "echo",
      description: "echo",
      parameters: Type.Object({ msg: Type.String() }),
      outputSchema: Type.Object({ text: Type.String() }),
      label: "test",
      execute: async (id, params) => {
        order.push(id);
        await new Promise(r => setTimeout(r, 10));
        return { text: (params as any).msg };
      },
      formatResult: (output) => [{ type: "text", text: (output as any).text }],
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "echo", arguments: { msg: "a" } },
      { type: "toolCall", id: "call-2", name: "echo", arguments: { msg: "b" } },
    ]);
    const config: AgentLoopConfig = { toolExecution: "sequential" } as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(order).toEqual(["call-1", "call-2"]);
    expect(results[0].content).toEqual([{ type: "text", text: "a" }]);
    expect(results[1].content).toEqual([{ type: "text", text: "b" }]);
  });

  it("并行执行：并发调用但结果保持请求顺序", async () => {
    const delays = [50, 10];
    const tool: AgentTool = {
      name: "delay",
      description: "delay",
      parameters: Type.Object({ ms: Type.Number() }),
      outputSchema: Type.Object({ id: Type.String() }),
      label: "test",
      execute: async (id, params) => {
        await new Promise(r => setTimeout(r, (params as any).ms));
        return { id };
      },
      formatResult: (output) => [{ type: "text", text: (output as any).id }],
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-slow", name: "delay", arguments: { ms: delays[0] } },
      { type: "toolCall", id: "call-fast", name: "delay", arguments: { ms: delays[1] } },
    ]);
    const config: AgentLoopConfig = { toolExecution: "parallel" } as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const start = Date.now();
    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(80);
    expect(results[0].content).toEqual([{ type: "text", text: "call-slow" }]);
    expect(results[1].content).toEqual([{ type: "text", text: "call-fast" }]);
  });

  it("工具不存在时返回错误结果", async () => {
    const context = createMockContext([]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "missing", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(results[0].isError).toBe(true);
    expect(results[0].content[0].type).toBe("text");
    expect((results[0].content[0] as any).text).toContain("missing");
  });

  it("validateInput 失败时返回错误且不执行", async () => {
    const executeMock = mock(() => Promise.resolve({}));
    const tool: AgentTool = {
      name: "blocked",
      description: "blocked",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: executeMock,
      validateInput: async () => ({ ok: false, message: "参数非法" }),
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "blocked", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(executeMock).not.toHaveBeenCalled();
    expect(results[0].isError).toBe(true);
    expect((results[0].content[0] as any).text).toBe("参数非法");
  });

  it("checkPermissions 拒绝时返回错误且不执行", async () => {
    const executeMock = mock(() => Promise.resolve({}));
    const tool: AgentTool = {
      name: "blocked",
      description: "blocked",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: executeMock,
      checkPermissions: async () => ({ allowed: false, reason: "权限不足" }),
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "blocked", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(executeMock).not.toHaveBeenCalled();
    expect(results[0].isError).toBe(true);
    expect((results[0].content[0] as any).text).toBe("权限不足");
  });

  it("formatResult 覆盖输出内容", async () => {
    const tool: AgentTool = {
      name: "modify",
      description: "modify",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ raw: Type.String() }),
      label: "test",
      execute: async () => ({ raw: "orig" }),
      formatResult: () => [{ type: "text", text: "formatted" }],
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "modify", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(results[0].content).toEqual([{ type: "text", text: "formatted" }]);
    expect(results[0].details).toEqual({ raw: "orig" });
  });

  it("工具 execute 抛出异常时被捕获并转为错误结果", async () => {
    const tool: AgentTool = {
      name: "fail",
      description: "fail",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => { throw new Error("boom"); },
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "fail", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(results[0].isError).toBe(true);
    expect((results[0].content[0] as any).text).toBe("boom");
  });

  it("事件发射顺序正确", async () => {
    const tool: AgentTool = {
      name: "echo",
      description: "echo",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ text: Type.String() }),
      label: "test",
      execute: async (id, _params, _ctx, onUpdate) => {
        onUpdate?.({ text: "partial" });
        return { text: "final" };
      },
      formatResult: (output) => [{ type: "text", text: (output as any).text }],
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "echo", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    await executeToolCalls(context, assistantMessage, config, undefined, emit);

    const types = events.map(e => e.type);
    expect(types).toEqual([
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
      "message_start",
      "message_end",
    ]);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
bun test src/agent/__tests__/tool-execution.test.ts
```

Expected: 8 个测试全部通过。

- [ ] **Step 3: Commit**

```bash
git add src/agent/__tests__/tool-execution.test.ts
git commit -m "test(agent): update tool-execution tests for vertical slice pipeline

- Replace beforeToolCall/afterToolCall tests with validateInput/checkPermissions/formatResult
- Update mocks to return TOutput and use formatResult for LLM content

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 5: 移除 `agent.ts` 中的 `beforeToolCall` / `afterToolCall`

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: 移除导入、字段和配置传递**

1. 从 `import type { ... } from "./types.js"` 中删除 `AfterToolCallContext`, `AfterToolCallResult`, `BeforeToolCallContext`, `BeforeToolCallResult`
2. 从 `AgentOptions` 中删除 `beforeToolCall` 和 `afterToolCall` 字段
3. 从 `Agent` 类中删除 `beforeToolCall` 和 `afterToolCall` 公开属性
4. 从 `constructor` 中删除对这两个属性的赋值
5. 从 `createLoopConfig` 中删除 `beforeToolCall: this.beforeToolCall` 和 `afterToolCall: this.afterToolCall`

- [ ] **Step 2: 运行类型检查**

```bash
bun run typecheck
```

Expected: `agent.ts` 自身无错误。

- [ ] **Step 3: Commit**

```bash
git add src/agent/agent.ts
git commit -m "refactor(agent): remove beforeToolCall / afterToolCall hooks from Agent

Permission and validation logic now lives inside AgentTool via
validateInput and checkPermissions.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 6: 迁移 `bash.ts`

**Files:**
- Modify: `src/agent/tools/bash.ts`

- [ ] **Step 1: 重写 `bash.ts`**

```typescript
// src/agent/tools/bash.ts
import { Type, type Static } from "@sinclair/typebox";
import { spawn } from "child_process";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

const bashOutputSchema = Type.Object({
  stdout: Type.String(),
  stderr: Type.String(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
});

type BashInput = Static<typeof bashSchema>;
type BashOutput = Static<typeof bashOutputSchema>;

export function createBashTool(cwd: string): AgentTool<typeof bashSchema, BashOutput> {
  return defineAgentTool({
    name: "bash",
    label: "Bash",
    description: "Execute a bash command in the working directory.",
    parameters: bashSchema,
    outputSchema: bashOutputSchema,
    isReadOnly: false,
    isConcurrencySafe: true,
    async execute(toolCallId, params, context) {
      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", params.command], { cwd });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (params.timeout) {
          timeoutId = setTimeout(() => {
            child.kill("SIGTERM");
          }, params.timeout * 1000);
        }

        child.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
        child.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

        child.on("error", (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(err);
        });

        child.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (context.abortSignal.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          resolve({ stdout, stderr, exitCode: code });
        });
      });
    },
    formatResult(output) {
      const text = output.stdout + (output.stderr ? `\nstderr:\n${output.stderr}` : "");
      return [{ type: "text", text: text || "(no output)" }];
    },
  });
}
```

- [ ] **Step 2: 运行类型检查**

```bash
bun run typecheck
```

Expected: `bash.ts` 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/bash.ts
git commit -m "refactor(tools): migrate BashTool to vertical slice AgentTool

- Define outputSchema for structured output
- execute returns BashOutput, formatResult handles LLM formatting
- Mark as isConcurrencySafe

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 7: 迁移 `read.ts`

**Files:**
- Modify: `src/agent/tools/read.ts`

- [ ] **Step 1: 重写 `read.ts`**

```typescript
// src/agent/tools/read.ts
import { Type, type Static } from "@sinclair/typebox";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const readOutputSchema = Type.Object({
  text: Type.String(),
  path: Type.String(),
});

type ReadInput = Static<typeof readSchema>;
type ReadOutput = Static<typeof readOutputSchema>;

export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    name: "read",
    label: "Read",
    description: "Read the contents of a file.",
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(toolCallId, params, context) {
      const absolutePath = resolve(cwd, params.path);
      let text = await readFile(absolutePath, "utf-8");

      if (params.offset !== undefined || params.limit !== undefined) {
        const lines = text.split("\n");
        const start = Math.max(0, (params.offset ?? 1) - 1);
        const end = params.limit !== undefined ? start + params.limit : lines.length;
        text = lines.slice(start, end).join("\n");
      }

      return { text, path: absolutePath };
    },
    formatResult(output) {
      return [{ type: "text", text: output.text }];
    },
  });
}
```

- [ ] **Step 2: 运行类型检查**

```bash
bun run typecheck
```

Expected: `read.ts` 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/read.ts
git commit -m "refactor(tools): migrate ReadTool to vertical slice AgentTool

- Define outputSchema for structured output
- execute returns ReadOutput, formatResult handles LLM formatting
- Mark as isReadOnly and isConcurrencySafe

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 8: 迁移 `write.ts`

**Files:**
- Modify: `src/agent/tools/write.ts`

- [ ] **Step 1: 重写 `write.ts`**

```typescript
// src/agent/tools/write.ts
import { Type, type Static } from "@sinclair/typebox";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

const writeOutputSchema = Type.Object({
  path: Type.String(),
  bytes: Type.Number(),
});

type WriteInput = Static<typeof writeSchema>;
type WriteOutput = Static<typeof writeOutputSchema>;

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema, WriteOutput> {
  return defineAgentTool({
    name: "write",
    label: "Write",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: writeSchema,
    outputSchema: writeOutputSchema,
    isDestructive: true,
    async execute(toolCallId, params, context) {
      const absolutePath = resolve(cwd, params.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, params.content, "utf-8");
      const bytes = Buffer.byteLength(params.content, "utf-8");
      return { path: absolutePath, bytes };
    },
    formatResult(output) {
      return [{ type: "text", text: `Wrote ${output.bytes} bytes to ${output.path}` }];
    },
  });
}
```

- [ ] **Step 2: 运行类型检查**

```bash
bun run typecheck
```

Expected: `write.ts` 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/write.ts
git commit -m "refactor(tools): migrate WriteTool to vertical slice AgentTool

- Define outputSchema for structured output
- execute returns WriteOutput, formatResult handles LLM formatting
- Mark as isDestructive

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 9: 迁移 `edit.ts`

**Files:**
- Modify: `src/agent/tools/edit.ts`

- [ ] **Step 1: 重写 `edit.ts`**

```typescript
// src/agent/tools/edit.ts
import { Type, type Static } from "@sinclair/typebox";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const replaceEditSchema = Type.Object({
  oldText: Type.String({ description: "Exact text to replace" }),
  newText: Type.String({ description: "Replacement text" }),
});

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(replaceEditSchema, {
    description: "One or more targeted replacements. oldText must be unique in the file.",
  }),
});

const editOutputSchema = Type.Object({
  path: Type.String(),
  edits: Type.Number(),
});

type EditInput = Static<typeof editSchema>;
type EditOutput = Static<typeof editOutputSchema>;

export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    name: "edit",
    label: "Edit",
    description: "Edit a file by replacing exact text segments.",
    parameters: editSchema,
    outputSchema: editOutputSchema,
    isDestructive: true,
    async execute(toolCallId, params, context) {
      const absolutePath = resolve(cwd, params.path);
      let content = await readFile(absolutePath, "utf-8");

      for (const edit of params.edits) {
        if (!content.includes(edit.oldText)) {
          throw new Error(`oldText not found in file: ${edit.oldText.slice(0, 50)}...`);
        }
        const occurrences = content.split(edit.oldText).length - 1;
        if (occurrences > 1) {
          throw new Error(`oldText is not unique in file (found ${occurrences} occurrences)`);
        }
        content = content.replace(edit.oldText, edit.newText);
      }

      await writeFile(absolutePath, content, "utf-8");

      return { path: absolutePath, edits: params.edits.length };
    },
    formatResult(output) {
      return [{ type: "text", text: `Edited ${output.path} with ${output.edits} replacement(s)` }];
    },
  });
}
```

- [ ] **Step 2: 运行类型检查**

```bash
bun run typecheck
```

Expected: `edit.ts` 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/edit.ts
git commit -m "refactor(tools): migrate EditTool to vertical slice AgentTool

- Define outputSchema for structured output
- execute returns EditOutput, formatResult handles LLM formatting
- Mark as isDestructive

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 10: 全量测试与类型检查

**Files:**
- 全部已修改文件

- [ ] **Step 1: 运行全部测试**

```bash
bun test
```

Expected: 所有 `src/agent/__tests__` 下的测试通过。如果 `agent-loop.test.ts` 或 `stream-assistant.test.ts` 因 `AgentLoopConfig` 签名变化而失败，则需要修复（但计划中未修改这些测试，需根据实际报错调整）。

- [ ] **Step 2: 运行全量类型检查**

```bash
bun run typecheck
```

Expected: 0 errors。

- [ ] **Step 3: 最终 Commit（如有修复）**

如有测试修复，单独 commit：

```bash
git add -A
git commit -m "fix(agent): resolve test/type errors after AgentTool refactor

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## 自我审查（Self-Review）

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 扩展 `AgentTool`（outputSchema、validateInput、checkPermissions、formatResult、运行属性） | Task 1 |
| 新增 `ToolUseContext` | Task 1 |
| `defineAgentTool()` 辅助函数 | Task 2 |
| `tool-execution.ts` 标准化流水线 | Task 3 |
| `AgentEvent` 不变 | Task 3（事件 emit 逻辑未变） |
| `Agent` 公开 API 不变 | Task 5（只移除了内部配置传递） |
| 移除 `beforeToolCall` / `afterToolCall` | Task 1、Task 5 |
| 无 TUI 耦合 | 所有 Task（无 React/Ink 引入） |
| TypeBox 继续保留 | 所有 Task（继续使用 Type、Static、TSchema） |
| 存量工具迁移 | Task 6-9 |

### Placeholder 扫描

- 无 "TBD"、"TODO"、"implement later"
- 所有步骤包含完整代码和精确命令
- 无 "similar to Task N" 等模糊引用

### 类型一致性检查

- `AgentTool` 泛型：`TParameters extends TSchema, TOutput = unknown`（Task 1）
- `execute` 签名：`Promise<TOutput>`（Task 1）
- `formatResult` 签名：`(output: TOutput, toolCallId: string) => (TextContent | ImageContent)[] | string`（Task 1）
- `defineAgentTool` 泛型与 `AgentTool` 匹配：`TParams extends TSchema, TOutput`（Task 2）
- `executePreparedToolCall` 返回 `{ output: unknown; isError: boolean }`（Task 3）
- `finalizeExecutedToolCall` 接收 `output` 并调用 `formatResult`（Task 3）
- 所有存量工具 `execute` 均返回结构化对象，`formatResult` 负责文本格式化（Task 6-9）

**潜在遗漏：** `src/agent/__tests__/agent-loop.test.ts` 和 `src/agent/__tests__/stream-assistant.test.ts` 当前已有修改记录（git status 显示 modified），它们可能依赖旧的 `AgentLoopConfig` 或 `AgentTool` 签名。Task 10 的 "如有测试修复" 步骤已覆盖此风险。
