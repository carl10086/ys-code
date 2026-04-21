// src/agent/__tests__/session.test.ts
import { describe, it, expect } from "bun:test";
import { AgentSession } from "./session.js";
import { getModel, asSystemPrompt } from "../core/ai/index.js";
import type { AgentMessage } from "./types.js";

describe("AgentSession", () => {
  it("should initialize with correct state", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    expect(session.isStreaming).toBe(false);
    expect(session.messages).toEqual([]);
    expect(session.model).toBe(model);
    expect(session.tools).toHaveLength(6); // 5 个默认工具 + SkillTool
  });

  it("should emit turn_start when agent emits turn_start", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" }, signal);
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_start");
    expect(events[0].modelName).toBe(model.name);
  });

  it("should convert thinking_delta with isFirst flag", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "hello" },
        },
        signal,
      );
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: " world" },
        },
        signal,
      );
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "thinking_delta", text: "hello", isFirst: true });
    expect(events[1]).toEqual({ type: "thinking_delta", text: " world", isFirst: false });
  });

  it("should convert text_delta with isFirst flag", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "text_delta", delta: "hi" },
        },
        signal,
      );
    });

    expect(events[0]).toEqual({ type: "answer_delta", text: "hi", isFirst: true });
  });

  it("should convert tool_execution_start and tool_execution_end", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "tool_execution_start",
        toolCallId: "tc1",
        toolName: "bash",
        args: { command: "echo hi" },
      }, signal);
      listener({
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "hi" }] },
        isError: false,
      }, signal);
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "tool_execution_start",
        toolCallId: "tc2",
        toolName: "bash",
        args: { command: "false" },
      }, signal);
      listener({
        type: "tool_execution_end",
        toolCallId: "tc2",
        toolName: "bash",
        result: { content: [{ type: "text", text: "command failed" }] },
        isError: true,
      }, signal);
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" }, signal);
      listener({
        type: "turn_end",
        message: {
          role: "assistant",
          content: [],
          usage: { totalTokens: 42, cost: { total: 0.001 } },
        },
        toolResults: [],
      }, signal);
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "turn_end",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
        toolResults: [],
      }, signal);
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "agent_start" }, signal);
      listener({ type: "agent_end", messages: [] }, signal);
    });

    expect(events).toHaveLength(0);
  });

  it("should reset agent state when reset() is called", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const agent = (session as any).agent;
    agent._state.messages.push({ role: "user", content: [{ type: "text", text: "test" }], timestamp: Date.now() });
    expect(session.messages).toHaveLength(1);
    session.reset();
    expect(session.messages).toEqual([]);
  });

  it("should clear per-turn state when reset() is called mid-turn", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" }, signal);
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "hello" },
        },
        signal,
      );
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: "thinking_delta", text: "hello", isFirst: true });

    session.reset();

    // After reset, a new turn_start should produce correct isFirst flags
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" }, signal);
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "world" },
        },
        signal,
      );
    });

    const secondTurnThinking = events.filter((e) => e.type === "thinking_delta")[1];
    expect(secondTurnThinking).toEqual({ type: "thinking_delta", text: "world", isFirst: true });

    // turn_end without matching turn_start after reset should report timeMs: 0
    agent.listeners.forEach((listener: any) => {
      listener({
        type: "turn_end",
        message: { role: "assistant", content: [], usage: { totalTokens: 1, cost: { total: 0 } } },
        toolResults: [],
      }, signal);
    });

    const lastTurnEnd = events.filter((e) => e.type === "turn_end").pop();
    expect(lastTurnEnd!.timeMs).toBeGreaterThanOrEqual(0);
  });

  it("should accept AgentMessage array in prompt()", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({
      cwd: "/tmp",
      model,
      apiKey: "test",
      systemPrompt: async () => asSystemPrompt([""]),
    });

    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
      { role: "user", content: [{ type: "text", text: "meta content" }], timestamp: Date.now(), isMeta: true },
    ];

    // Mock agent.prompt to track calls
    const agent = (session as any).agent;
    const originalPrompt = agent.prompt;
    let calledWith: any = undefined;
    agent.prompt = async (msgs: any) => { calledWith = msgs; };

    await session.prompt(messages);

    expect(calledWith).toEqual(messages);
    expect(calledWith[1].isMeta).toBe(true);

    agent.prompt = originalPrompt;
  });
});
