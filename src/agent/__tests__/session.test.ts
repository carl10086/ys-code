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
  });

  it("should emit turn_start when agent emits turn_start", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
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
