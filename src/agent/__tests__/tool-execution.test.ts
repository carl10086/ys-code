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
