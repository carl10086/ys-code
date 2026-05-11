import { describe, it, expect } from "bun:test";
import { Agent } from "./agent.js";
import { asSystemPrompt } from "../core/ai/index.js";
import type { AgentMessage, AgentTool } from "./types.js";

describe("Agent state mutations", () => {
  const createAgent = () =>
    new Agent({
      systemPrompt: async () => asSystemPrompt([""]),
    });

  it("appendMessage should add message to state", () => {
    const agent = createAgent();
    const msg: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    };

    agent.appendMessage(msg);

    expect(agent.state.messages).toHaveLength(1);
    expect(agent.state.messages[0]).toEqual(msg);
  });

  it("appendMessage should not mutate the original array", () => {
    const agent = createAgent();
    const before = agent.state.messages;
    const msg: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    };

    agent.appendMessage(msg);

    expect(agent.state.messages).not.toBe(before);
  });

  it("registerTool should add tool to state", () => {
    const agent = createAgent();
    const tool: AgentTool = {
      name: "TestTool",
      description: "A test tool",
      parameters: { type: "object", properties: {} } as any,
      outputSchema: { type: "object", properties: {} } as any,
      label: "test",
      execute: async () => "done",
    };

    agent.registerTool(tool);

    expect(agent.state.tools).toHaveLength(1);
    expect(agent.state.tools[0].name).toBe("TestTool");
  });

  it("compactMessages should replace all messages", () => {
    const agent = createAgent();
    agent.appendMessage({
      role: "user",
      content: [{ type: "text", text: "old" }],
      timestamp: 1,
    });

    const newMessages: AgentMessage[] = [
      { role: "compact_boundary", uuid: "test-uuid", timestamp: 2, compactMetadata: { preTokens: 0, postTokens: 0 } as any },
    ];

    agent.compactMessages(newMessages);

    expect(agent.state.messages).toHaveLength(1);
    expect(agent.state.messages[0].role).toBe("compact_boundary");
  });

  it("compactMessages should defensively copy input", () => {
    const agent = createAgent();
    const input: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ];

    agent.compactMessages(input);
    input.push({ role: "user", content: [{ type: "text", text: "extra" }], timestamp: 2 });

    expect(agent.state.messages).toHaveLength(1);
  });
});
