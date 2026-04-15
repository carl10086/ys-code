import { describe, it, expect } from "bun:test";
import { runAgentLoop, runAgentLoopContinue } from "../agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "../types.js";
import type { AssistantMessage, Message } from "../../core/ai/types.js";

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
      convertToLlm: (m: any[]) => m as Message[],
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
    expect(result.length).toBe(2);
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
      convertToLlm: (m: any[]) => m as Message[],
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

    expect(callCount).toBe(1);
    const messages = events.filter(e => e.type === "message_start").map((e: any) => e.message);
    const steering = messages.find((m: any) => m.role === "user" && (m.content as any)[0]?.text === "steer-1");
    expect(steering).toBeDefined();
  });

  it("followUpMessages 在即将停止时触发新一轮", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    let followUpCall = 0;
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
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
      convertToLlm: (m: any[]) => m as Message[],
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
      convertToLlm: (m: any[]) => m as Message[],
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
      convertToLlm: (m: any[]) => m as Message[],
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
    const config: AgentLoopConfig = { model: createMockModel(), convertToLlm: (m: any[]) => m as Message[] } as any;

    expect(runAgentLoopContinue(context, config, async () => {}, undefined)).rejects.toThrow("Cannot continue from message role: assistant");
  });

  it("空消息时抛出错误", async () => {
    const context: AgentContext = { systemPrompt: "test", messages: [], tools: [] };
    const config: AgentLoopConfig = { model: createMockModel(), convertToLlm: (m: any[]) => m as Message[] } as any;

    expect(runAgentLoopContinue(context, config, async () => {}, undefined)).rejects.toThrow("Cannot continue: no messages in context");
  });
});

describe("runLoop 控制流结构", () => {
  it("不应包含 firstTurn 标志", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/agent/agent-loop.ts", "utf-8");
    expect(source).not.toContain("firstTurn");
  });

  it("应包含 runTurnOnce 函数", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/agent/agent-loop.ts", "utf-8");
    expect(source).toContain("async function runTurnOnce");
  });

  it("不应包含未使用的 createAgentStream 函数", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/agent/agent-loop.ts", "utf-8");
    expect(source).not.toContain("createAgentStream");
  });
});
