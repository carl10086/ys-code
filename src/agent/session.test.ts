// src/agent/__tests__/session.test.ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { AgentSession } from "./session.js";
import { getModel, asSystemPrompt } from "../core/ai/index.js";
import type { AgentMessage } from "./types.js";
import { COMPACT_SUMMARY_SECTIONS } from "../session/compact/index.js";

describe("AgentSession", () => {
  let tmpDir: string;

  const validCompactSummary = () => `<summary>${COMPACT_SUMMARY_SECTIONS
    .map((section) => `${section}\nContent for ${section}`)
    .join("\n\n")}</summary>`;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "agent-session-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize with correct state", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    expect(session.isStreaming).toBe(false);
    expect(session.messages).toEqual([]);
    expect(session.model).toBe(model);
    expect(session.tools.map((tool) => tool.name)).toContain("Grep");
    expect(session.tools).toHaveLength(8); // 7 个默认工具 + SkillTool
  });

  it("should emit turn_start when agent emits turn_start", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
        result: {
          content: [{ type: "text", text: "hi" }],
          renderData: { type: "plain", text: "rendered hi" },
        },
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
      renderData: { type: "plain", text: "rendered hi" },
    });
    expect(typeof events[1].timeMs).toBe("number");
  });

  it("should convert tool_execution_end error to tool_end with error summary", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "agent_start" }, signal);
      listener({ type: "agent_end" }, signal);
    });

    expect(events).toHaveLength(0);
  });

  it("should reset agent state when reset() is called", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent._state.messages.push({ role: "user", content: [{ type: "text", text: "test" }], timestamp: Date.now() });
    expect(session.messages).toHaveLength(1);
    session.reset();
    expect(session.messages).toEqual([]);
  });

  it("should clear per-turn state when reset() is called mid-turn", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
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

  it("compact should replace messages with compact result and command records", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    const result = await session.compact({
      commandText: "/compact 只关注代码修改",
      instructions: "只关注代码修改",
      summaryRunner: async () => validCompactSummary(),
    });

    expect(session.messages).toEqual(result.postCompactMessages);
    expect(session.messages[0].role).toBe("compact_boundary");
    expect((session.messages[0] as any).compactMetadata.summaryCheck).toEqual({
      ok: true,
      sectionCount: COMPACT_SUMMARY_SECTIONS.length,
      missingSections: [],
    });
    expect(session.messages[1].role).toBe("user");
    expect((session.messages[2] as any).content[0].text).toBe("/compact 只关注代码修改");
    expect((session.messages[3] as any).isMeta).toBe(true);
    expect((session.messages[3] as any).content[0].text).toContain("<local-command-stdout>");
    expect(JSON.stringify(session.messages)).not.toContain("old history");
  });

  it("compact should preserve invoked skill attachments in active messages", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];
    session.invokedSkills.set("cc-diff", {
      name: "cc-diff",
      path: ".claude/skills/cc-diff/SKILL.md",
      content: "Compare CC and YS implementations.",
      invokedAt: 123,
    });

    const result = await session.compact({
      summaryRunner: async () => validCompactSummary(),
    });

    expect(result.attachments).toHaveLength(1);
    const restoredAttachment = session.messages.find((message) => (
      message.role === "attachment" && message.attachment.type === "invoked_skills"
    ));
    expect(restoredAttachment).toBeDefined();
    expect((session.messages[0] as any).compactMetadata.attachmentStats.generated).toEqual([
      { type: "invoked_skills", count: 1 },
    ]);
  });

  it("compact should persist compacted messages for session restore", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    await session.compact({
      commandText: "/compact",
      summaryRunner: async () => validCompactSummary(),
    });

    const restored = (session as any).sessionManager.restoreMessages();
    expect(restored[0].role).toBe("compact_boundary");
    expect(restored[1].role).toBe("user");
    expect((restored[1] as any).isMeta).toBe(true);
    expect((restored[2] as any).content[0].text).toBe("/compact");
    expect(JSON.stringify(restored)).not.toContain("old history");
  });

  it("compact should keep messages unchanged when summary generation fails", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const originalMessages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];
    (session as any).agent.state.messages = originalMessages;

    await expect(session.compact({
      commandText: "/compact",
      summaryRunner: async () => {
        throw new Error("summary failed");
      },
    })).rejects.toThrow("summary failed");

    expect(session.messages).toEqual(originalMessages);
  });

  it("compact should keep messages unchanged when summary is missing required sections", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const originalMessages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];
    (session as any).agent.state.messages = originalMessages;

    await expect(session.compact({
      commandText: "/compact",
      summaryRunner: async () => "<summary>1. Primary Request and Intent:\nOnly one section.</summary>",
    })).rejects.toThrow("missing required sections");

    expect(session.messages).toEqual(originalMessages);
  });

  it("compact should keep messages unchanged when summary is plain text", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const originalMessages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];
    (session as any).agent.state.messages = originalMessages;

    await expect(session.compact({
      commandText: "/compact",
      summaryRunner: async () => "Already concise",
    })).rejects.toThrow("missing required sections");

    expect(session.messages).toEqual(originalMessages);
  });

  it("compact should fail without replacing messages if messages change while summary is pending", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    let resolveSummary!: (summary: string) => void;
    const compactPromise = session.compact({
      commandText: "/compact",
      summaryRunner: async () => new Promise<string>((resolve) => {
        resolveSummary = resolve;
      }),
    });

    agent.appendMessage({
      role: "user",
      content: [{ type: "text", text: "late message" }],
      timestamp: 2,
    });
    resolveSummary(validCompactSummary());

    await expect(compactPromise).rejects.toThrow("changed during compact");
    expect(JSON.stringify(session.messages)).toContain("late message");
    expect(session.messages[0].role).toBe("user");
  });

  it("compact should reject while streaming", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent.state.isStreaming = true;
    agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    await expect(session.compact({
      commandText: "/compact",
      summaryRunner: async () => validCompactSummary(),
    })).rejects.toThrow("streaming");

    expect(session.messages).toHaveLength(1);
    expect((session.messages[0] as any).content[0].text).toBe("old history");
  });

  it("compact should reject duplicate compact while one is pending", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    (session as any).agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    let resolveSummary!: (summary: string) => void;
    const firstCompact = session.compact({
      commandText: "/compact",
      summaryRunner: async () => new Promise<string>((resolve) => {
        resolveSummary = resolve;
      }),
    });

    await expect(session.compact({
      commandText: "/compact",
      summaryRunner: async () => validCompactSummary(),
    })).rejects.toThrow("already in progress");

    resolveSummary(validCompactSummary());
    await firstCompact;
  });

  it("compact default summary runner should call the model with tools disabled", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    const agent = (session as any).agent;
    agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    let streamOptions: any;
    agent.streamFn = async function* (_model: unknown, options: any) {
      streamOptions = options;
      yield {
        type: "done",
        message: {
          content: [{ type: "text", text: validCompactSummary() }],
        },
      };
    };

    await session.compact({ commandText: "/compact" });

    expect(streamOptions.tools).toEqual([]);
  });

  it("restoreSession should restore compacted active context from transcript", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const firstSession = new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]), sessionBaseDir: tmpDir });
    (firstSession as any).agent.state.messages = [
      { role: "user", content: [{ type: "text", text: "old history" }], timestamp: 1 },
    ];

    await firstSession.compact({
      commandText: "/compact",
      summaryRunner: async () => validCompactSummary(),
    });

    const restoredSession = new AgentSession({
      cwd: "/tmp",
      model,
      apiKey: "test",
      systemPrompt: async () => asSystemPrompt([""]),
      sessionBaseDir: tmpDir,
      restoreSession: true,
    });

    expect(restoredSession.messages[0].role).toBe("compact_boundary");
    expect(JSON.stringify(restoredSession.messages)).toContain("Content for 1. Primary Request and Intent:");
    expect(JSON.stringify(restoredSession.messages)).not.toContain("old history");
  });

  it("should accept AgentMessage array in prompt()", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({
      cwd: "/tmp",
      model,
      apiKey: "test",
      systemPrompt: async () => asSystemPrompt([""]),
      sessionBaseDir: tmpDir,
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

  it("prompt with model option should override and restore", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({
      cwd: "/tmp",
      model,
      apiKey: "test",
      systemPrompt: async () => asSystemPrompt([""]),
      sessionBaseDir: tmpDir,
    });

    const agent = (session as any).agent;
    const originalPrompt = agent.prompt;
    let modelDuringPrompt = "";
    agent.prompt = async () => {
      modelDuringPrompt = session.model.name;
    };

    await session.prompt("hello", { model: "MiniMax-M2.7" });

    expect(modelDuringPrompt).toBe("MiniMax-M2.7");
    expect(session.model.name).toBe("MiniMax-M2.7-highspeed");

    agent.prompt = originalPrompt;
  });

  it("prompt with invalid model option should ignore and warn", async () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({
      cwd: "/tmp",
      model,
      apiKey: "test",
      systemPrompt: async () => asSystemPrompt([""]),
      sessionBaseDir: tmpDir,
    });

    const agent = (session as any).agent;
    const originalPrompt = agent.prompt;
    let modelDuringPrompt = "";
    agent.prompt = async () => {
      modelDuringPrompt = session.model.name;
    };

    await session.prompt("hello", { model: "nonexistent-model" });

    expect(modelDuringPrompt).toBe("MiniMax-M2.7-highspeed");
    expect(session.model.name).toBe("MiniMax-M2.7-highspeed");

    agent.prompt = originalPrompt;
  });
});

describe("AgentSession attachment handling", () => {
  it("should append attachment message to sessionManager on message_end", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const appendSpy = spyOn((session as any)["sessionManager"], "appendMessage");

    const attachmentMessage: AgentMessage = {
      role: "attachment",
      attachment: { type: "file", filePath: "/test.ts", displayPath: "test.ts", content: { type: "text", text: "" }, timestamp: 1000 },
      timestamp: 1000,
    } as AgentMessage;

    // 通过 agent 触发事件
    (session as any)["handleAgentEvent"]({ type: "message_end", message: attachmentMessage });

    expect(appendSpy).toHaveBeenCalledWith(attachmentMessage);
  });

  it("should mark skills as sent for skill_listing attachment", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const skillMessage: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Skills",
        skillNames: ["read", "write"],
        timestamp: 1000,
      },
      timestamp: 1000,
    } as AgentMessage;

    session["handleAgentEvent"]({ type: "message_end", message: skillMessage });

    expect(session.sentSkillNames.has("read")).toBe(true);
    expect(session.sentSkillNames.has("write")).toBe(true);
  });

  it("should not affect sentSkillNames for non-skill attachment", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const initialSize = session.sentSkillNames.size;

    const fileMessage: AgentMessage = {
      role: "attachment",
      attachment: { type: "file", filePath: "/test.ts", displayPath: "test.ts", content: { type: "text", text: "" }, timestamp: 1000 },
      timestamp: 1000,
    } as AgentMessage;

    session["handleAgentEvent"]({ type: "message_end", message: fileMessage });

    expect(session.sentSkillNames.size).toBe(initialSize);
  });

  it("should not affect sentSkillNames for regular assistant message", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const initialSize = session.sentSkillNames.size;

    const assistantMessage: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      timestamp: 1000,
    } as AgentMessage;

    session["handleAgentEvent"]({ type: "message_end", message: assistantMessage });

    expect(session.sentSkillNames.size).toBe(initialSize);
  });

  it("should record invoked skill metadata from successful Skill tool results", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    session["handleAgentEvent"]({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "Skill",
        content: [],
        details: {
          success: true,
          skillName: "cc-diff",
          skillPath: ".claude/skills/cc-diff/SKILL.md",
          skillContent: "Skill content",
          invokedAt: 123,
        },
        isError: false,
        timestamp: 123,
      } as AgentMessage,
    });

    expect(session.invokedSkills.get("cc-diff")).toEqual({
      name: "cc-diff",
      path: ".claude/skills/cc-diff/SKILL.md",
      content: "Skill content",
      invokedAt: 123,
    });
  });

  it("should not record invoked skills for failed or non-Skill tool results", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    session["handleAgentEvent"]({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "Skill",
        content: [],
        details: {
          success: true,
          skillName: "cc-diff",
          skillPath: ".claude/skills/cc-diff/SKILL.md",
          skillContent: "Skill content",
          invokedAt: 123,
        },
        isError: true,
        timestamp: 123,
      } as AgentMessage,
    });

    session["handleAgentEvent"]({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "Read",
        content: [],
        details: {
          success: true,
          skillName: "read",
          skillContent: "not a skill",
          invokedAt: 124,
        },
        isError: false,
        timestamp: 124,
      } as AgentMessage,
    });

    expect(session.invokedSkills.size).toBe(0);
  });

  it("should keep the latest invoked skill record for repeated skill calls", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    session["handleAgentEvent"]({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "Skill",
        content: [],
        details: {
          success: true,
          skillName: "cc-diff",
          skillPath: "old/path",
          skillContent: "old content",
          invokedAt: 100,
        },
        isError: false,
        timestamp: 100,
      } as AgentMessage,
    });

    session["handleAgentEvent"]({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "Skill",
        content: [],
        details: {
          success: true,
          skillName: "cc-diff",
          skillPath: "new/path",
          skillContent: "new content",
          invokedAt: 200,
        },
        isError: false,
        timestamp: 200,
      } as AgentMessage,
    });

    expect(session.invokedSkills.get("cc-diff")).toEqual({
      name: "cc-diff",
      path: "new/path",
      content: "new content",
      invokedAt: 200,
    });
  });
});
