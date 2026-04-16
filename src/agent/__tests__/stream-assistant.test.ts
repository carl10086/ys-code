import { describe, it, expect } from "bun:test";
import { streamAssistantResponse } from "../stream-assistant.js";
import { createAssistantMessageEventStream } from "../../core/ai/utils/event-stream.js";
import type { AgentContext, AgentEvent, AgentLoopConfig } from "../types.js";
import type { AssistantMessage, Message } from "../../core/ai/types.js";
import { asSystemPrompt } from "../../core/ai/types.js";

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
    systemPrompt: asSystemPrompt(["test"]),
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
