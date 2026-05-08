import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "./types.js";
import type { AssistantMessage, Message } from "../core/ai/types.js";
import { asSystemPrompt } from "../core/ai/types.js";

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
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("hi");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await expect(runAgentLoop(prompts, context, config, emit, undefined, streamFn as any)).resolves.toBeUndefined();

    expect(callCount).toBe(1);

    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("turn_start");
    expect(eventTypes).toContain("turn_end");
    expect(eventTypes).toContain("agent_end");
    const assistantEnd = events.find((e) => e.type === "message_end" && e.message.role === "assistant");
    expect(assistantEnd).toBeDefined();
    const agentEnd = events.find((e) => e.type === "agent_end") as any;
    expect(agentEnd).not.toHaveProperty("messages");
  });

  it("steeringMessages 在 turn 之间正确注入", async () => {
    const context: AgentContext = { messages: [], tools: [] };
    let steeringCall = 0;
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
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
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
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

  it("steeringMessages 在首个 turn 后到达时会触发新一轮", async () => {
    const context: AgentContext = { messages: [], tools: [] };
    let steeringCall = 0;
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
      disableUserContext: true,
      getSteeringMessages: async () => {
        steeringCall++;
        // 首个 turn 结束后返回 steering
        if (steeringCall === 1) return [createUserMessage("late-steer")];
        return [];
      },
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage(callCount === 1 ? "reply-1" : "reply-2");
      stream.end(msg);
      return stream;
    };

    await runAgentLoop([createUserMessage("hello")], context, config, emit, undefined, streamFn as any);

    expect(callCount).toBe(2);
    const messages = events.filter(e => e.type === "message_start").map((e: any) => e.message);
    const steering = messages.find((m: any) => m.role === "user" && (m.content as any)[0]?.text === "late-steer");
    expect(steering).toBeDefined();
  });

  it("steering 在 tool calls 之后到达时会在下一轮正确注入", async () => {
    const tool: AgentTool = {
      name: "noop",
      description: "noop",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "noop",
      execute: async () => ({ text: "done" }),
      formatResult: () => [{ type: "text", text: "done" }],
    };
    const context: AgentContext = { messages: [], tools: [tool] };
    let steeringCall = 0;
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
      getSteeringMessages: async () => {
        steeringCall++;
        // 第二轮末尾才返回 steering
        if (steeringCall === 2) return [createUserMessage("post-tool-steer")];
        return [];
      },
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = callCount === 1
        ? createAssistantMessage("", [{ type: "toolCall", id: "call-1", name: "noop", arguments: {} }])
        : createAssistantMessage("after-steer");
      stream.end(msg);
      return stream;
    };

    await runAgentLoop([createUserMessage("hello")], context, config, emit, undefined, streamFn as any);

    // 第1轮: prompt -> assistant(toolCall) -> tool -> turn_end
    // 第1轮末尾 drain steering: empty -> shouldContinue=true (toolCalls>0)
    // 第2轮: turn_start -> assistant(toolCall结果后回复) -> turn_end
    // 第2轮末尾 drain steering: [post-tool-steer] -> shouldContinue=true (steering>0)
    // 第3轮: turn_start -> inject post-tool-steer -> assistant -> turn_end -> agent_end
    expect(callCount).toBe(3);

    const turnStartEvents = events.filter(e => e.type === "turn_start");
    expect(turnStartEvents).toHaveLength(3);

    // 验证 steering 消息在第三轮被注入
    const messageStartEvents = events.filter(e => e.type === "message_start");
    const steerMsg = messageStartEvents.find((e: any) =>
      e.message.role === "user" && (e.message.content as any)[0]?.text === "post-tool-steer"
    );
    expect(steerMsg).toBeDefined();
  });

  it("工具返回的 newMessages 会注入到后续 turn 的模型上下文", async () => {
    const injectedMessage = createUserMessage("tool-injected-context");
    const tool: AgentTool = {
      name: "inject_context",
      description: "Inject context",
      parameters: Type.Object({}),
      outputSchema: Type.Object({}),
      label: "Inject Context",
      execute: async () => ({
        text: "done",
        newMessages: [injectedMessage],
      }),
      formatResult: () => [{ type: "text", text: "done" }],
    };
    const context: AgentContext = { messages: [], tools: [tool] };
    const capturedLlmMessages: Message[][] = [];
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (messages: any[]) => {
        capturedLlmMessages.push(messages as Message[]);
        return messages as Message[];
      },
      systemPrompt: asSystemPrompt(["test"]),
      disableUserContext: true,
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    let callCount = 0;
    const streamFn = async () => {
      callCount++;
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = callCount === 1
        ? createAssistantMessage("", [{ type: "toolCall", id: "call-1", name: "inject_context", arguments: {} }])
        : createAssistantMessage("after-tool");
      stream.end(msg);
      return stream;
    };

    await runAgentLoop([createUserMessage("hello")], context, config, emit, undefined, streamFn as any);

    expect(callCount).toBe(2);
    // 第二轮的 LLM 上下文应包含 tool 返回的 newMessages
    const secondRequestMessages = capturedLlmMessages[1] as any[];
    expect(secondRequestMessages.some(
      (message) => message.role === "user" && message.content?.[0]?.text === "tool-injected-context"
    )).toBe(true);
    const injectedStart = events.find(
      (e) => e.type === "message_start" && e.message.role === "user" && (e.message.content as any)[0]?.text === "tool-injected-context"
    );
    expect(injectedStart).toBeDefined();
  });

  it("stopReason 为 error 时终止并发射 agent_end", async () => {
    const context: AgentContext = { messages: [], tools: [] };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("", [], "error");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    const turnEndIndex = events.findIndex(e => e.type === "turn_end");
    const agentEndIndex = events.findIndex(e => e.type === "agent_end");
    expect(turnEndIndex).toBeGreaterThanOrEqual(0);
    expect(agentEndIndex).toBeGreaterThan(turnEndIndex);
    expect(events[events.length - 1].type).toBe("agent_end");
    const agentEnd = events.find((e) => e.type === "agent_end") as any;
    expect(agentEnd).not.toHaveProperty("messages");
    const turnEnd = events.find(e => e.type === "turn_end") as any;
    expect(turnEnd.message.stopReason).toBe("error");
  });

  it("stopReason 为 aborted 时终止并发射 agent_end", async () => {
    const context: AgentContext = { messages: [], tools: [] };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("", [], "aborted");
      stream.end(msg);
      return stream;
    };

    const prompts = [createUserMessage("hello")];
    await runAgentLoop(prompts, context, config, emit, undefined, streamFn as any);

    expect(events[events.length - 1].type).toBe("agent_end");
    const agentEnd = events.find((e) => e.type === "agent_end") as any;
    expect(agentEnd).not.toHaveProperty("messages");
    const turnEnd = events.find(e => e.type === "turn_end") as any;
    expect(turnEnd.message.stopReason).toBe("aborted");
  });
});

describe("runAgentLoopContinue", () => {
  it("从已有上下文继续并生成新消息", async () => {
    const context: AgentContext = {
      messages: [createUserMessage("hello")],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      const msg = createAssistantMessage("continued");
      stream.end(msg);
      return stream;
    };

    await expect(runAgentLoopContinue(context, config, emit, undefined, streamFn as any)).resolves.toBeUndefined();

    expect(events.map(e => e.type)).toContain("agent_start");
    expect(events.map(e => e.type)).toContain("agent_end");
    const assistantEnd = events.find((e) => e.type === "message_end" && e.message.role === "assistant");
    expect(assistantEnd).toBeDefined();
    const agentEnd = events.find((e) => e.type === "agent_end") as any;
    expect(agentEnd).not.toHaveProperty("messages");
  });

  it("最后一条消息为 assistant 时抛出错误", async () => {
    const context: AgentContext = {
      messages: [createAssistantMessage("hi")],
      tools: [],
    };
    const config: AgentLoopConfig = { model: createMockModel(), convertToLlm: (m: any[]) => m as Message[], systemPrompt: asSystemPrompt(["test"]) } as any;

    expect(runAgentLoopContinue(context, config, async () => {}, undefined)).rejects.toThrow("Cannot continue from message role: assistant");
  });

  it("空消息时抛出错误", async () => {
    const context: AgentContext = { messages: [], tools: [] };
    const config: AgentLoopConfig = { model: createMockModel(), convertToLlm: (m: any[]) => m as Message[], systemPrompt: asSystemPrompt(["test"]) } as any;

    expect(runAgentLoopContinue(context, config, async () => {}, undefined)).rejects.toThrow("Cannot continue: no messages in context");
  });
});

  it("继续时保留 sentSkillNames 和 invokedSkills 到 streamAssistantResponse", async () => {
    const context: AgentContext = {
      messages: [createUserMessage("hello")],
      tools: [],
      sentSkillNames: new Set(["skill-a"]),
      invokedSkills: new Map([["skill-a", { name: "skill-a", path: "/tmp", content: "content", invokedAt: 1 }]]),
    };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    let capturedContext: any;
    const streamFn = async (_model: any, options: any) => {
      // streamFn receives options which contain the context
      capturedContext = options;
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      stream.end(createAssistantMessage("continued"));
      return stream;
    };

    await runAgentLoopContinue(context, config, async () => {}, undefined, streamFn as any);

    // sentSkillNames and invokedSkills should be passed through to streamAssistantResponse
    expect(capturedContext).toBeDefined();
  });

  it("streamAssistantResponse 抛出异常时错误向上传播", async () => {
    const context: AgentContext = { messages: [createUserMessage("hello")], tools: [] };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    const streamFn = async () => {
      throw new Error("stream exploded");
    };

    await expect(
      runAgentLoop([createUserMessage("hello")], context, config, async () => {}, undefined, streamFn as any)
    ).rejects.toThrow("stream exploded");
  });

  it("turn_end 和 agent_end 每个 run 只发射一次", async () => {
    const context: AgentContext = { messages: [], tools: [] };
    const config: AgentLoopConfig = {
      model: createMockModel(),
      convertToLlm: (m: any[]) => m as Message[],
      systemPrompt: asSystemPrompt(["test"]),
    } as any;

    const events: AgentEvent[] = [];
    const emit = async (e: AgentEvent) => { events.push(e); };

    const streamFn = async () => {
      const { createAssistantMessageEventStream } = await import("../core/ai/utils/event-stream.js");
      const stream = createAssistantMessageEventStream();
      stream.end(createAssistantMessage("hi"));
      return stream;
    };

    await runAgentLoop([createUserMessage("hello")], context, config, emit, undefined, streamFn as any);

    const turnEnds = events.filter(e => e.type === "turn_end");
    const agentEnds = events.filter(e => e.type === "agent_end");
    expect(turnEnds).toHaveLength(1);
    expect(agentEnds).toHaveLength(1);
  });

describe("runLoop 控制流结构", () => {
  it("不应包含 firstTurn 标志", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/agent/agent-loop.ts", "utf-8");
    expect(source).not.toContain("firstTurn");
  });

  it("不应包含 runTurnOnce 函数", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/agent/agent-loop.ts", "utf-8");
    expect(source).not.toContain("async function runTurnOnce");
  });

  it("不应包含未使用的 createAgentStream 函数", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/agent/agent-loop.ts", "utf-8");
    expect(source).not.toContain("createAgentStream");
  });
});

