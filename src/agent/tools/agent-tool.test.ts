import { describe, it, expect, beforeEach } from "bun:test";
import { Agent } from "../agent.js";
import { createAgentTool } from "./agent-tool.js";
import type { AgentTool } from "../types.js";

function createMockStreamFn(responseText: string) {
  return async (..._args: any[]) => {
    const { AssistantMessageEventStream } = await import("../../core/ai/utils/event-stream.js");
    const stream = new AssistantMessageEventStream();
    const assistantMessage = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: responseText }],
      stopReason: "end_turn",
      api: "anthropic",
      provider: "anthropic",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    stream.end(assistantMessage as any);
    return stream as any;
  };
}

describe("AgentTool", () => {
  let parent: Agent;
  let tool: ReturnType<typeof createAgentTool>;

  beforeEach(() => {
    parent = new Agent({
      streamFn: createMockStreamFn("Subagent completed the task") as any,
    });
    tool = createAgentTool(parent);
  });

  it("工具元数据符合预期", () => {
    expect(tool.name).toBe("Agent");
    expect(tool.label).toBe("Agent");
    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.isDestructive).toBe(false);
  });

  it("description 是非空字符串", () => {
    expect(typeof tool.description).toBe("string");
    expect((tool.description as string).length).toBeGreaterThan(10);
  });

  it("execute 成功调用子代理并返回结果", async () => {
    const output = await tool.execute(
      "call-1",
      { prompt: "Please summarize this file" },
      {
        abortSignal: new AbortController().signal,
        messages: [],
        tools: [],
        fileStateCache: parent.getFileStateCache(),
      } as any,
    );

    expect(output.result).toBe("Subagent completed the task");
  });

  it("execute 返回的 outputSchema 包含 result 字段", async () => {
    const output = await tool.execute(
      "call-2",
      { prompt: "Hello" },
      {
        abortSignal: new AbortController().signal,
        messages: [],
        tools: [],
        fileStateCache: parent.getFileStateCache(),
      } as any,
    );

    expect(typeof output.result).toBe("string");
  });

  it("execute 后父代理状态不受影响", async () => {
    parent.appendMessage({
      role: "user",
      content: [{ type: "text", text: "original" }],
      timestamp: Date.now(),
    });
    const originalMessages = parent.state.messages.length;

    await tool.execute(
      "call-3",
      { prompt: "Do something" },
      {
        abortSignal: new AbortController().signal,
        messages: [],
        tools: [],
        fileStateCache: parent.getFileStateCache(),
      } as any,
    );

    expect(parent.state.messages.length).toBe(originalMessages);
  });

  it("formatResult 返回文本格式", () => {
    const result = tool.formatResult!({ result: "test result" }, "call-1");
    expect(Array.isArray(result)).toBe(true);
    const items = result as Array<{ text: string }>;
    expect(items[0].text).toContain("test result");
  });
});
