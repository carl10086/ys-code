// src/agent/__tests__/session.test.ts
import { describe, it, expect } from "bun:test";
import { AgentSession } from "../session.js";
import { getModel } from "../../core/ai/index.js";

describe("AgentSession", () => {
  it("should initialize with correct state", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    expect(session.isStreaming).toBe(false);
    expect(session.messages).toEqual([]);
    expect(session.model).toBe(model);
    expect(session.tools).toHaveLength(4);
  });

  it("should reject both systemPrompt and systemPromptSections", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    expect(() => {
      new AgentSession({
        cwd: "/tmp",
        model,
        apiKey: "test",
        systemPrompt: "hello",
        systemPromptSections: [{ name: "test", compute: async () => "test" }],
      });
    }).toThrow("Cannot provide both systemPrompt and systemPromptSections");
  });

  it("should emit turn_start when agent emits turn_start", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" });
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_start");
    expect(events[0].modelName).toBe(model.name);
  });

  it("should convert thinking_delta with isFirst flag", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "hello" },
        },
      );
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: " world" },
        },
      );
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "thinking_delta", text: "hello", isFirst: true });
    expect(events[1]).toEqual({ type: "thinking_delta", text: " world", isFirst: false });
  });

  it("should convert text_delta with isFirst flag", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "text_delta", delta: "hi" },
        },
      );
    });

    expect(events[0]).toEqual({ type: "answer_delta", text: "hi", isFirst: true });
  });

  it("should convert tool_execution_start and tool_execution_end", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "tool_execution_start",
        toolCallId: "tc1",
        toolName: "bash",
        args: { command: "echo hi" },
      });
      listener({
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "hi" }] },
        isError: false,
      });
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "echo hi" },
      isFirst: true,
    });
    expect(events[1]).toMatchObject({
      type: "tool_end",
      toolCallId: "tc1",
      toolName: "bash",
      isError: false,
      summary: "hi",
    });
    expect(typeof events[1].timeMs).toBe("number");
  });

  it("should convert tool_execution_end error to tool_end with error summary", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "tool_execution_start",
        toolCallId: "tc2",
        toolName: "bash",
        args: { command: "false" },
      });
      listener({
        type: "tool_execution_end",
        toolCallId: "tc2",
        toolName: "bash",
        result: { content: [{ type: "text", text: "command failed" }] },
        isError: true,
      });
    });

    expect(events[1]).toMatchObject({
      type: "tool_end",
      toolCallId: "tc2",
      toolName: "bash",
      isError: true,
      summary: "command failed",
    });
  });

  it("should emit turn_end with usage for assistant message", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" });
      listener({
        type: "turn_end",
        message: {
          role: "assistant",
          content: [],
          usage: { totalTokens: 42, cost: { total: 0.001 } },
        },
        toolResults: [],
      });
    });

    const turnEnd = events.find((e) => e.type === "turn_end");
    expect(turnEnd).toEqual({
      type: "turn_end",
      tokens: 42,
      cost: 0.001,
      timeMs: expect.any(Number),
    });
  });

  it("should emit turn_end with zeros for non-assistant message", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "turn_end",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
        toolResults: [],
      });
    });

    const turnEnd = events.find((e) => e.type === "turn_end");
    expect(turnEnd).toEqual({
      type: "turn_end",
      tokens: 0,
      cost: 0,
      timeMs: expect.any(Number),
    });
  });

  it("should ignore agent_start and agent_end events", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "agent_start" });
      listener({ type: "agent_end", messages: [] });
    });

    expect(events).toHaveLength(0);
  });

  it("should reset agent state when reset() is called", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const agent = (session as any).agent;
    agent._state.messages.push({ role: "user", content: [{ type: "text", text: "test" }], timestamp: Date.now() });
    expect(session.messages).toHaveLength(1);
    session.reset();
    expect(session.messages).toEqual([]);
  });
});
