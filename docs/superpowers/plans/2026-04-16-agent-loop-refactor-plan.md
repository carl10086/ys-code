# agent-loop.ts 可读性重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步执行。步骤使用复选框（`- [ ]`）语法进行跟踪。

**Goal:** 将 `src/agent/agent-loop.ts` 拆分为职责清晰的三个模块，消除重复逻辑，统一使用纯中文注释，并通过严格的 TDD 确保外部行为零变化。

**Architecture:** 采用 TDD 先行策略：先为现有行为编写全面的单元测试，再逐步提取 `stream-assistant.ts` 和 `tool-execution.ts`，最后精简 `agent-loop.ts` 的主循环。所有步骤通过测试守护，确保重构安全。

**Tech Stack:** TypeScript, Bun (bun test)

---

## 文件结构

```
src/agent/
  agent-loop.ts              # 保留入口函数和主循环编排
  stream-assistant.ts        # 流式响应提取模块
  tool-execution.ts          # 工具执行提取模块
  types.ts                   # 现有类型定义（不修改）
  agent.ts                   # 现有 Agent 包装类（不修改）
  index.ts                   # 现有导出（不修改）
  __tests__/
    stream-assistant.test.ts # 流式响应单元测试
    tool-execution.test.ts   # 工具执行单元测试
    agent-loop.test.ts       # 主循环单元测试
```

---

## 任务分解

### Task 1: 为 stream-assistant 编写单元测试

**Files:**
- Create: `src/agent/__tests__/stream-assistant.test.ts`

- [ ] **Step 1.1: 创建测试文件并编写基础用例**

编写以下测试，覆盖正常流式事件、无流直接返回、streamFunction 异常、取消信号、事件时序：

```typescript
import { describe, it, expect } from "bun:test";
import { streamAssistantResponse } from "../stream-assistant.js";
import { createAssistantMessageEventStream } from "../../core/ai/utils/event-stream.js";
import type { AgentContext, AgentEvent, AgentLoopConfig } from "../types.js";
import type { AssistantMessage, Message } from "../../core/ai/types.js";

function createMockConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: {
      id: "test-model",
      name: "test",
      api: "anthropic-messages",
      provider: "minimax",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    },
    convertToLlm: (messages: any[]) => messages as Message[],
    ...overrides,
  } as AgentLoopConfig;
}

function createMockContext(): AgentContext {
  return {
    systemPrompt: "test",
    messages: [],
    tools: [],
  };
}

describe("streamAssistantResponse", () => {
  it("正常流式响应：正确处理 start、text_delta、done 事件", async () => {
    const context = createMockContext();
    const config = createMockConfig();
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const stream = createAssistantMessageEventStream();
      const partial: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial });
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "hello",
        partial: { ...partial, content: [{ type: "text", text: "hello" }] },
      });
      const final: AssistantMessage = { ...partial, content: [{ type: "text", text: "hello" }] };
      stream.push({ type: "done", reason: "stop", message: final });
      return stream;
    };

    const result = await streamAssistantResponse(context, config, undefined, emit, streamFn as any);

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(events.map(e => e.type)).toEqual([
      "message_start",
      "message_update",
      "message_update",
      "message_end",
    ]);
  });

  it("无流事件直接返回结果：触发 message_start + message_end", async () => {
    const context = createMockContext();
    const config = createMockConfig();
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const final: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "direct" }],
      api: "anthropic-messages",
      provider: "minimax",
      model: "test-model",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const streamFn = async () => {
      const stream = createAssistantMessageEventStream();
      stream.end(final);
      return stream;
    };

    const result = await streamAssistantResponse(context, config, undefined, emit, streamFn as any);

    expect(result.content).toEqual([{ type: "text", text: "direct" }]);
    expect(events.map(e => e.type)).toEqual(["message_start", "message_end"]);
  });

  it("streamFunction 抛出异常时向上传播", async () => {
    const context = createMockContext();
    const config = createMockConfig();
    const emit = async () => {};

    const streamFn = async () => {
      throw new Error("stream failed");
    };

    expect(streamAssistantResponse(context, config, undefined, emit, streamFn as any)).rejects.toThrow("stream failed");
  });

  it("signal aborted 时 streamFunction 应收到取消信号", async () => {
    const context = createMockContext();
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };
    const controller = new AbortController();
    controller.abort();

    let receivedSignal: AbortSignal | undefined;
    const streamFn = async (_model: any, _ctx: any, options: any) => {
      receivedSignal = options?.signal;
      const stream = createAssistantMessageEventStream();
      const final: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "aborted",
        timestamp: Date.now(),
      };
      stream.end(final);
      return stream;
    };

    const config = createMockConfig();
    await streamAssistantResponse(context, config, controller.signal, emit, streamFn as any);

    expect(receivedSignal?.aborted).toBe(true);
  });
});
```

- [ ] **Step 1.2: 运行测试确认失败**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/__tests__/stream-assistant.test.ts
```

**Expected:** 测试失败，因为 `../stream-assistant.js` 不存在。

---

### Task 2: 为 tool-execution 编写单元测试

**Files:**
- Create: `src/agent/__tests__/tool-execution.test.ts`

- [ ] **Step 2.1: 创建测试文件并编写全部用例**

```typescript
import { describe, it, expect, mock } from "bun:test";
import { executeToolCalls } from "../tool-execution.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentTool } from "../types.js";
import type { AssistantMessage } from "../../core/ai/types.js";
import { Type } from "@sinclair/typebox";

function createMockContext(tools: AgentTool<any>[] = []): AgentContext {
  return {
    systemPrompt: "test",
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
      label: "test",
      execute: async (id, params) => {
        order.push(id);
        await new Promise(r => setTimeout(r, 10));
        return {
          content: [{ type: "text", text: (params as any).msg }],
          details: {},
        };
      },
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
      label: "test",
      execute: async (id, params) => {
        await new Promise(r => setTimeout(r, (params as any).ms));
        return {
          content: [{ type: "text", text: id }],
          details: {},
        };
      },
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

    expect(elapsed).toBeLessThan(80); // 并行应小于串行总时间
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

  it("beforeToolCall 拦截时返回错误且不执行", async () => {
    const executeMock = mock(() => Promise.resolve({ content: [], details: {} }));
    const tool: AgentTool = {
      name: "blocked",
      description: "blocked",
      parameters: Type.Object({}),
      label: "test",
      execute: executeMock,
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "blocked", arguments: {} },
    ]);
    const config: AgentLoopConfig = {
      beforeToolCall: async () => ({ block: true, reason: "不允许执行" }),
    } as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(executeMock).not.toHaveBeenCalled();
    expect(results[0].isError).toBe(true);
    expect((results[0].content[0] as any).text).toBe("不允许执行");
  });

  it("afterToolCall 覆盖结果和错误状态", async () => {
    const tool: AgentTool = {
      name: "modify",
      description: "modify",
      parameters: Type.Object({}),
      label: "test",
      execute: async () => ({ content: [{ type: "text", text: "orig" }], details: {} }),
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "modify", arguments: {} },
    ]);
    const config: AgentLoopConfig = {
      afterToolCall: async () => ({
        content: [{ type: "text", text: "modified" }],
        isError: true,
      }),
    } as any;
    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const results = await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(results[0].content).toEqual([{ type: "text", text: "modified" }]);
    expect(results[0].isError).toBe(true);
  });

  it("工具 execute 抛出异常时被捕获并转为错误结果", async () => {
    const tool: AgentTool = {
      name: "fail",
      description: "fail",
      parameters: Type.Object({}),
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
      label: "test",
      execute: async (id, _params, _signal, onUpdate) => {
        onUpdate?.({ content: [{ type: "text", text: "partial" }], details: {} });
        return { content: [{ type: "text", text: "final" }], details: {} };
      },
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

- [ ] **Step 2.2: 运行测试确认失败**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/__tests__/tool-execution.test.ts
```

**Expected:** 测试失败，因为 `../tool-execution.js` 不存在。

---

### Task 3: 为 agent-loop 编写单元测试

**Files:**
- Create: `src/agent/__tests__/agent-loop.test.ts`

- [ ] **Step 3.1: 创建测试文件并编写全部用例**

```typescript
import { describe, it, expect, mock } from "bun:test";
import { runAgentLoop, runAgentLoopContinue } from "../agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "../types.js";
import type { AssistantMessage, Message, ToolResultMessage } from "../../core/ai/types.js";

function createMockModel(): any {
  return {
    id: "test-model",
    name: "test",
    api: "anthropic-messages",
    provider: "minimax",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function createUserMessage(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function createAssistantMessage(text: string, toolCalls: any[] = [], stopReason: any = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: toolCalls.length > 0 ? toolCalls : [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "minimax",
    model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: Date.now(),
  };
}

describe("runAgentLoop", () => {
  it("完整流程：用户消息 -> assistant 回复 -> 无工具 -> 正常结束", async () => {
    const context: AgentContext = {
      systemPrompt: "test",
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m) => m as Message[],
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("hi");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    const result = await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    expect(callCount).toBe(1);
    expect(result.length).toBe(2); // prompt + assistant
    expect(result[1].role).toBe("assistant");

    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("turn_start");
    expect(eventTypes).toContain("turn_end");
    expect(eventTypes).toContain("agent_end");
  });

  it("steeringMessages 在 turn 之间正确注入", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    let steeringCall = 0;
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m) => m as Message[],
      getSteeringMessages: async () => {
        steeringCall++;
        if (steeringCall === 1) return [createUserMessage("steer-1")];
        return [];
      },
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage(callCount === 1 ? "reply-1" : "reply-2");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    expect(callCount).toBe(2);
    const messages = events.filter(e => e.type === "message_start").map((e: any) => e.message);
    const steering = messages.find((m: any) => m.role === "user" && (m.content as any)[0]?.text === "steer-1");
    expect(steering).toBeDefined();
  });

  it("followUpMessages 在即将停止时触发新一轮", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    let followUpCall = 0;
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m) => m as Message[],
      getFollowUpMessages: async () => {
        followUpCall++;
        if (followUpCall === 1) return [createUserMessage("follow-up")];
        return [];
      },
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("hi");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    expect(callCount).toBe(2);
    const messages = events.filter(e => e.type === "message_start").map((e: any) => e.message);
    const followUp = messages.find((m: any) => m.role === "user" && (m.content as any)[0]?.text === "follow-up");
    expect(followUp).toBeDefined();
  });

  it("stopReason 为 error 时终止并发射 agent_end", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m) => m as Message[],
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("", [], "error");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    expect(events[events.length - 1].type).toBe("agent_end");
    const turnEnd = events.find(e => e.type === "turn_end") as any;
    expect(turnEnd.message.stopReason).toBe("error");
  });

  it("stopReason 为 aborted 时终止并发射 agent_end", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m) => m as Message[],
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("", [], "aborted");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    expect(events[events.length - 1].type).toBe("agent_end");
    const turnEnd = events.find(e => e.type === "turn_end") as any;
    expect(turnEnd.message.stopReason).toBe("aborted");
  });
});

describe("runAgentLoopContinue", () => {
  it("从已有上下文继续并生成新消息", async () => {
    const context: AgentContext = {
      systemPrompt: "test",
      messages: [createUserMessage("hello")],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m) => m as Message[],
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("continued");
      stream.end(msg);
      return stream;
    };

    const result = await runAgentLoopContinue(context, config, emit, undefined, streamFn as any);

    expect(result.length).toBe(1);
    expect(result[0].role).toBe("assistant");
    expect(events.map(e => e.type)).toContain("agent_start");
    expect(events.map(e => e.type)).toContain("agent_end");
  });

  it("最后一条消息为 assistant 时抛出错误", async () => {
    const context: AgentContext = {
      systemPrompt: "test",
      messages: [createAssistantMessage("hi")],
      tools: [],
    };
    const config: AgentLoopConfig = { model: createMockModel(), convertToLlm: (m) => m as Message[] } as any;

    expect(runAgentLoopContinue(context, config, async () => {}, undefined)).rejects.toThrow("Cannot continue from message role: assistant");
  });

  it("空消息时抛出错误", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    const config: AgentLoopConfig = { model: createMockModel(), convertToLlm: (m) => m as Message[] } as any;

    expect(runAgentLoopContinue(context, config, async () => {}, undefined)).rejects.toThrow("Cannot continue: no messages in context");
  });
});
```

- [ ] **Step 3.2: 运行测试确认通过（此时应通过，因为还未修改 agent-loop.ts）**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/__tests__/agent-loop.test.ts
```

**Expected:** 测试通过（因为当前 `agent-loop.ts` 实现是正确的基准）。

---

### Task 4: 提取 stream-assistant.ts

**Files:**
- Create: `src/agent/stream-assistant.ts`
- Modify: `src/agent/agent-loop.ts`（删除已迁移的 `streamAssistantResponse` 函数，改为导入）

- [ ] **Step 4.1: 创建 stream-assistant.ts**

```typescript
// src/agent/stream-assistant.ts
import {
  type AssistantMessage,
  type Context,
  type ToolResultMessage,
  streamSimple,
  type AssistantMessageEvent,
} from "../core/ai/index.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  StreamFn,
} from "./types.js";

/** 事件发射器类型 */
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * 统一处理流结束后的消息替换、追加和事件发射
 */
async function finalizeStreamMessage(
  context: AgentContext,
  finalMessage: AssistantMessage,
  addedPartial: boolean,
  emit: AgentEventSink,
): Promise<void> {
  if (addedPartial) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: "message_start", message: { ...finalMessage } });
  }
  await emit({ type: "message_end", message: finalMessage });
}

/**
 * 流式获取 assistant 响应
 */
export async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  const llmMessages = await config.convertToLlm(messages);

  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools as any,
  };

  const streamFunction = streamFn || streamSimple;

  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

  const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
  });

  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;

  for await (const event of response) {
    switch (event.type) {
      case "start":
        partialMessage = event.partial;
        context.messages.push(partialMessage);
        addedPartial = true;
        await emit({ type: "message_start", message: { ...partialMessage } });
        break;

      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        if (partialMessage) {
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: "message_update",
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

      case "done":
      case "error": {
        const finalMessage = await response.result();
        if (addedPartial) {
          context.messages[context.messages.length - 1] = finalMessage;
        } else {
          context.messages.push(finalMessage);
        }
        if (!addedPartial) {
          await emit({ type: "message_start", message: { ...finalMessage } });
        }
        await emit({ type: "message_end", message: finalMessage });
        return finalMessage;
      }
    }
  }

  const finalMessage = await response.result();
  await finalizeStreamMessage(context, finalMessage, addedPartial, emit);
  return finalMessage;
}
```

**注意：** 上面的 `streamAssistantResponse` 里 `done/error` 分支和 `for await` 结束后仍然有重复。需要在 Step 4.2 中消除这个重复。

- [ ] **Step 4.2: 消除 finalize 重复逻辑**

修改 `src/agent/stream-assistant.ts` 中 `done/error` 分支和循环结束后的代码，统一调用 `finalizeStreamMessage`：

将 `done/error` 分支替换为：
```typescript
      case "done":
      case "error": {
        const finalMessage = await response.result();
        await finalizeStreamMessage(context, finalMessage, addedPartial, emit);
        return finalMessage;
      }
```

将循环结束后代码替换为：
```typescript
  const finalMessage = await response.result();
  await finalizeStreamMessage(context, finalMessage, addedPartial, emit);
  return finalMessage;
```

- [ ] **Step 4.3: 修改 agent-loop.ts 删除 streamAssistantResponse 并改为导入**

在 `src/agent/agent-loop.ts` 顶部添加导入：
```typescript
import { streamAssistantResponse, type AgentEventSink } from "./stream-assistant.js";
```

删除文件中 `AgentEventSink` 类型定义和 `streamAssistantResponse` 函数的完整实现。

- [ ] **Step 4.4: 运行 stream-assistant 和 agent-loop 测试**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/__tests__/stream-assistant.test.ts
bun test src/agent/__tests__/agent-loop.test.ts
```

**Expected:** 全部通过。

- [ ] **Step 4.5: Commit**

```bash
git add src/agent/stream-assistant.ts src/agent/agent-loop.ts src/agent/__tests__/stream-assistant.test.ts
git commit -m "refactor(agent): 提取 stream-assistant 模块并消除重复 finalize 逻辑"
```

---

### Task 5: 提取 tool-execution.ts

**Files:**
- Create: `src/agent/tool-execution.ts`
- Modify: `src/agent/agent-loop.ts`（删除已迁移的工具执行代码，改为导入）

- [ ] **Step 5.1: 创建 tool-execution.ts**

```typescript
// src/agent/tool-execution.ts
import { validateToolArguments } from "../core/ai/index.js";
import type { ToolResultMessage } from "../core/ai/types.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
} from "./types.js";
import type { AgentEventSink } from "./stream-assistant.js";

/** 已准备好的工具调用 */
type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
};

/** 立即返回结果的工具调用 */
type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
};

/** 已执行的工具调用结果 */
type ExecutedToolCallOutcome = {
  result: AgentToolResult<any>;
  isError: boolean;
};

function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

async function emitToolCallOutcome(
  toolCall: AgentToolCall,
  result: AgentToolResult<any>,
  isError: boolean,
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  await emit({
    type: "tool_execution_end",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result,
    isError,
  });

  const toolResultMessage: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    details: result.details,
    isError,
    timestamp: Date.now(),
  };

  await emit({ type: "message_start", message: toolResultMessage });
  await emit({ type: "message_end", message: toolResultMessage });
  return toolResultMessage;
}

async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: any,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const validatedArgs = validateToolArguments(tool as any, toolCall);
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext,
        },
        signal,
      );
      if (beforeResult?.block) {
        return {
          kind: "immediate",
          result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
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

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
  const updateEvents: Promise<void>[] = [];

  try {
    const result = await prepared.tool.execute(
      prepared.toolCall.id,
      prepared.args as never,
      signal,
      (partialResult) => {
        updateEvents.push(
          Promise.resolve(
            emit({
              type: "tool_execution_update",
              toolCallId: prepared.toolCall.id,
              toolName: prepared.toolCall.name,
              args: prepared.toolCall.arguments,
              partialResult,
            }),
          ),
        );
      },
    );
    await Promise.all(updateEvents);
    return { result, isError: false };
  } catch (error) {
    await Promise.all(updateEvents);
    return {
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

async function finalizeExecutedToolCall(
  currentContext: AgentContext,
  assistantMessage: any,
  prepared: PreparedToolCall,
  executed: ExecutedToolCallOutcome,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    const afterResult = await config.afterToolCall(
      {
        assistantMessage,
        toolCall: prepared.toolCall,
        args: prepared.args,
        result,
        isError,
        context: currentContext,
      },
      signal,
    );
    if (afterResult) {
      result = {
        content: afterResult.content ?? result.content,
        details: afterResult.details ?? result.details,
      };
      isError = afterResult.isError ?? isError;
    }
  }

  return await emitToolCallOutcome(prepared.toolCall, result, isError, emit);
}

/** 工具执行入口函数 */
export async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: any,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const toolCalls = (assistantMessage.content || []).filter((c: any) => c.type === "toolCall") as AgentToolCall[];
  if (config.toolExecution === "sequential") {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}

async function executeToolCallsSequential(
  currentContext: AgentContext,
  assistantMessage: any,
  toolCalls: AgentToolCall[],
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
      const executed = await executePreparedToolCall(preparation, signal, emit);
      results.push(
        await finalizeExecutedToolCall(
          currentContext,
          assistantMessage,
          preparation,
          executed,
          config,
          signal,
          emit,
        ),
      );
    }
  }

  return results;
}

async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: any,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];
  const runnableCalls: PreparedToolCall[] = [];

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
    execution: executePreparedToolCall(prepared, signal, emit),
  }));

  // 并行执行所有工具
  const executedResults = await Promise.all(
    runningCalls.map((r) => r.execution),
  );

  // 顺序处理结果（保持原结果的顺序）
  for (let i = 0; i < executedResults.length; i++) {
    const executed = executedResults[i];
    const prepared = runningCalls[i].prepared;
    const finalResult = await finalizeExecutedToolCall(
      currentContext,
      assistantMessage,
      prepared,
      executed,
      config,
      signal,
      emit,
    );
    results.push(finalResult);
  }

  return results;
}
```

- [ ] **Step 5.2: 修改 agent-loop.ts 删除工具执行代码并改为导入**

在 `src/agent/agent-loop.ts` 顶部添加导入：
```typescript
import { executeToolCalls } from "./tool-execution.js";
```

删除文件中以下内容：
- `PreparedToolCall` 类型定义
- `ImmediateToolCallOutcome` 类型定义
- `ExecutedToolCallOutcome` 类型定义
- `createErrorToolResult` 函数
- `emitToolCallOutcome` 函数
- `prepareToolCall` 函数
- `executePreparedToolCall` 函数
- `finalizeExecutedToolCall` 函数
- `executeToolCalls` 函数
- `executeToolCallsSequential` 函数
- `executeToolCallsParallel` 函数

- [ ] **Step 5.3: 运行 tool-execution 和 agent-loop 测试**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/__tests__/tool-execution.test.ts
bun test src/agent/__tests__/agent-loop.test.ts
```

**Expected:** 全部通过。

- [ ] **Step 5.4: Commit**

```bash
git add src/agent/tool-execution.ts src/agent/agent-loop.ts src/agent/__tests__/tool-execution.test.ts
git commit -m "refactor(agent): 提取 tool-execution 模块"
```

---

### Task 6: 精简 agent-loop.ts 主循环

**Files:**
- Modify: `src/agent/agent-loop.ts`

- [ ] **Step 6.1: 简化 runLoop 的 firstTurn 逻辑**

将 `runLoop` 和 `runAgentLoop` / `runAgentLoopContinue` 中的 `firstTurn` 标志去除，改为在入口函数中先发射一次 `turn_start`。

修改 `runAgentLoop` 为：
```typescript
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}
```

修改 `runAgentLoopContinue` 为：
```typescript
export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages[context.messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = { ...context };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}
```

修改 `runLoop` 为（去除 `firstTurn`）：
```typescript
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  while (true) {
    let hasMoreToolCalls = true;

    while (hasMoreToolCalls || pendingMessages.length > 0) {
      await emit({ type: "turn_start" });

      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
      newMessages.push(message);

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "turn_end", message, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      const toolCalls = message.content.filter((c) => c.type === "toolCall");
      hasMoreToolCalls = toolCalls.length > 0;

      const toolResults: import("../core/ai/types.js").ToolResultMessage[] = [];
      if (hasMoreToolCalls) {
        toolResults.push(...(await executeToolCalls(currentContext, message, config, signal, emit)));

        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      await emit({ type: "turn_end", message, toolResults });

      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }

    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}
```

注意：`agent-loop.ts` 的顶部导入现在应该包含 `AgentEventSink` 来自 `stream-assistant.js`。

- [ ] **Step 6.2: 运行全部测试**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/__tests__
```

**Expected:** 全部通过。

- [ ] **Step 6.3: Commit**

```bash
git add src/agent/agent-loop.ts
git commit -m "refactor(agent): 精简 runLoop，移除 firstTurn 标志"
```

---

### Task 7: 最终验证与清理

**Files:**
- Modify: 所有已变更的 `src/agent/*.ts` 文件（添加纯中文注释，检查 unused imports）

- [ ] **Step 7.1: 检查并补充纯中文注释**

审查以下文件，确保所有 JSDoc 和普通注释为纯中文：
- `src/agent/stream-assistant.ts`
- `src/agent/tool-execution.ts`
- `src/agent/agent-loop.ts`

关键注释点：
- `createAgentStream`: `// 创建 agent 事件流`
- `runLoop`: `// 主循环逻辑`
- `streamAssistantResponse`: `// 流式获取 assistant 响应`
- `executeToolCalls`: `// 工具执行入口函数`
- `executeToolCallsParallel` 中的 `// 并行执行所有工具` 和 `// 顺序处理结果（保持原结果的顺序）`

- [ ] **Step 7.2: 运行类型检查和全部测试**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun run typecheck
bun test src/agent/__tests__
```

**Expected:** 类型检查零错误，测试全部通过。

- [ ] **Step 7.3: 确认外部 API 未变化**

```bash
grep -n "export" src/agent/index.ts
```

**Expected:** 输出应与重构前完全一致，仍为：
```
export * from "./types.js";
export * from "./agent-loop.js";
export { Agent, type AgentOptions } from "./agent.js";
```

- [ ] **Step 7.4: 统计行数确认目标达成**

```bash
wc -l src/agent/agent-loop.ts
```

**Expected:** 行数在 150 以内。

- [ ] **Step 7.5: Commit**

```bash
git add src/agent/
git commit -m "style(agent): 统一纯中文注释并完成 agent-loop 重构"
```

---

## 计划自检

### Spec 覆盖检查

| Spec 要求 | 对应任务 |
|-----------|----------|
| TDD 先行：先写测试再重构 | Task 1-3 |
| 拆分为 stream-assistant.ts | Task 4 |
| 拆分为 tool-execution.ts | Task 5 |
| agent-loop.ts 行数降到 150 以内 | Task 6-7 |
| 消除 streamAssistantResponse 重复 finalize | Task 4.2 |
| 简化 runLoop，移除 firstTurn | Task 6.1 |
| 纯中文注释 | Task 7.1 |
| 外部 API 不变 | Task 7.3 |
| 类型检查和测试通过 | 每个 Task 的验证步骤 |

### 占位符扫描

- 无 TBD/TODO
- 无 "适当处理"/"添加验证" 等模糊表述
- 每个代码步骤包含完整代码
- 每个测试步骤包含完整测试代码

### 类型一致性检查

- `AgentEventSink` 定义在 `stream-assistant.ts` 并导出，被 `agent-loop.ts` 和 `tool-execution.ts` 导入
- `executeToolCalls` 在 `tool-execution.ts` 中导出，被 `agent-loop.ts` 导入
- `streamAssistantResponse` 在 `stream-assistant.ts` 中导出，被 `agent-loop.ts` 导入
- 函数签名和类型与现有代码完全一致

---

## 执行方式

Plan complete and saved to `docs/superpowers/plans/2026-04-16-agent-loop-refactor-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
