import { describe, it, expect, mock } from "bun:test";
import { executeToolCalls } from "./tool-execution.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentTool } from "./types.js";
import type { AssistantMessage } from "../core/ai/types.js";
import { asSystemPrompt } from "../core/ai/types.js";
import { Type } from "@sinclair/typebox";

function createMockContext(tools: AgentTool<any, any>[] = []): AgentContext {
  return {
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

  it("工具返回 newMessages 时加入 currentContext.pendingMessages", async () => {
    const tool: AgentTool = {
      name: "meta",
      description: "meta",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => ({
        text: "done",
        newMessages: [{ role: "user", content: "meta-msg", timestamp: Date.now() }],
      }),
      formatResult: () => [{ type: "text", text: "done" }],
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "meta", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const emit = async () => {};

    await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(context.pendingMessages).toHaveLength(1);
    expect((context.pendingMessages![0] as any).content).toBe("meta-msg");
  });

  it("工具返回 modelOverride 时写入 currentContext.modelOverride", async () => {
    const tool: AgentTool = {
      name: "model",
      description: "model",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => ({
        text: "done",
        modelOverride: "MiniMax-M2.7",
      }),
      formatResult: () => [{ type: "text", text: "done" }],
    };

    const context = createMockContext([tool]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "model", arguments: {} },
    ]);
    const config: AgentLoopConfig = {} as any;
    const emit = async () => {};

    await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(context.modelOverride).toBe("MiniMax-M2.7");
  });

  it("多个工具返回 modelOverride 时后者覆盖前者", async () => {
    const toolA: AgentTool = {
      name: "toolA",
      description: "toolA",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => ({ modelOverride: "model-A" }),
      formatResult: () => [{ type: "text", text: "a" }],
    };
    const toolB: AgentTool = {
      name: "toolB",
      description: "toolB",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => ({ modelOverride: "model-B" }),
      formatResult: () => [{ type: "text", text: "b" }],
    };

    const context = createMockContext([toolA, toolB]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "toolA", arguments: {} },
      { type: "toolCall", id: "call-2", name: "toolB", arguments: {} },
    ]);
    const config: AgentLoopConfig = { toolExecution: "sequential" } as any;
    const emit = async () => {};

    await executeToolCalls(context, assistantMessage, config, undefined, emit);

    expect(context.modelOverride).toBe("model-B");
  });

  it("并行执行时 modelOverride 由最后完成的工具决定", async () => {
    const toolFast: AgentTool = {
      name: "fast",
      description: "fast",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => {
        await new Promise(r => setTimeout(r, 5));
        return { modelOverride: "model-fast" };
      },
      formatResult: () => [{ type: "text", text: "fast" }],
    };
    const toolSlow: AgentTool = {
      name: "slow",
      description: "slow",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "test",
      execute: async () => {
        await new Promise(r => setTimeout(r, 30));
        return { modelOverride: "model-slow" };
      },
      formatResult: () => [{ type: "text", text: "slow" }],
    };

    const context = createMockContext([toolFast, toolSlow]);
    const assistantMessage = createMockAssistantMessage([
      { type: "toolCall", id: "call-1", name: "fast", arguments: {} },
      { type: "toolCall", id: "call-2", name: "slow", arguments: {} },
    ]);
    const config: AgentLoopConfig = { toolExecution: "parallel" } as any;
    const emit = async () => {};

    await executeToolCalls(context, assistantMessage, config, undefined, emit);

    // slow 工具后完成，其 modelOverride 应覆盖 fast 的
    expect(context.modelOverride).toBe("model-slow");
  });
});
