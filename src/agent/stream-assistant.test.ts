import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { streamAssistantResponse, injectAtMentionAttachments } from "./stream-assistant.js";
import { createAssistantMessageEventStream } from "../core/ai/utils/event-stream.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "./types.js";
import type { AssistantMessage, Message } from "../core/ai/types.js";
import { asSystemPrompt } from "../core/ai/types.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearMemoryFilesCache } from "../utils/claudemd.js";
import { clearUserContextCache } from "./context/user-context.js";

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
    convertToLlm: (messages: any[]) => [...messages] as Message[],
    systemPrompt: asSystemPrompt(["test"]),
    ...overrides,
  } as AgentLoopConfig;
}

function createMockContext(): AgentContext {
  return {
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

describe("streamAssistantResponse userContext integration", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sa-uc-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    clearMemoryFilesCache();
    clearUserContextCache();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("默认应自动 prepend userContext 到 messages", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Test rules");

    const context = createMockContext();
    const config = createMockConfig();

    let capturedMessages: Message[] | undefined;
    const streamFn = async (_model: any, ctx: any) => {
      capturedMessages = ctx.messages;
      const stream = createAssistantMessageEventStream();
      const final: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.end(final);
      return stream;
    };

    await streamAssistantResponse(context, config, undefined, async () => {}, streamFn as any);

    expect(capturedMessages).toBeDefined();
    expect(capturedMessages!.length).toBeGreaterThan(0);
    expect((capturedMessages![0] as any).role).toBe("user");
    expect((capturedMessages![0] as any).content).toContain("<system-reminder>");
  });

  it("disableUserContext 为 true 时不应 prepend meta message", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Test rules");

    const context = createMockContext();
    const config = createMockConfig({ disableUserContext: true });

    let capturedMessages: Message[] | undefined;
    const streamFn = async (_model: any, ctx: any) => {
      capturedMessages = ctx.messages;
      const stream = createAssistantMessageEventStream();
      const final: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.end(final);
      return stream;
    };

    await streamAssistantResponse(context, config, undefined, async () => {}, streamFn as any);

    expect(capturedMessages).toBeDefined();
    expect(capturedMessages!.length).toBe(0);
  });

  // 新增测试：验证 attachment → normalize → convertToLlm 链路
  it("convertToLlm 收到的消息应为 Message[]（无 attachment）", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Test");

    const context = createMockContext();

    let receivedMessages: Message[] | undefined;
    const config = createMockConfig({
      convertToLlm: (messages: any[]) => {
        receivedMessages = messages as Message[];
        return messages as Message[];
      },
    });

    const streamFn = async () => {
      const stream = createAssistantMessageEventStream();
      const final: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.end(final);
      return stream;
    };

    await streamAssistantResponse(context, config, undefined, async () => {}, streamFn as any);

    expect(receivedMessages).toBeDefined();
    // convertToLlm 收到的是 normalize 后的消息，不应包含 attachment
    for (const msg of receivedMessages!) {
      expect(msg.role).not.toBe("attachment");
    }
  });
});

describe("injectAtMentionAttachments", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sa-am-"));
    writeFileSync(join(tempDir, "test.txt"), "hello world");
    writeFileSync(join(tempDir, "other.ts"), "const x = 1;");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("空消息数组应返回空数组", async () => {
    const result = await injectAtMentionAttachments([], tempDir);
    expect(result).toEqual([]);
  });

  it("无 @ 引用的消息应原样返回", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result).toEqual(messages);
  });

  it("user message 中的 @file 应注入 attachment", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "查看 @test.txt", timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toMatchObject({
      role: "attachment",
      attachment: {
        type: "file",
        filePath: join(tempDir, "test.txt"),
        content: "hello world",
        displayPath: "test.txt",
      },
    });
  });

  it("多个 @ 引用应注入多个 attachment", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "查看 @test.txt 和 @other.ts", timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toMatchObject({
      role: "attachment",
      attachment: { type: "file", filePath: join(tempDir, "test.txt") },
    });
    expect(result[2]).toMatchObject({
      role: "attachment",
      attachment: { type: "file", filePath: join(tempDir, "other.ts") },
    });
  });

  it("非 user message 应跳过", async () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "@test.txt" }], timestamp: 1, api: "anthropic-messages", provider: "minimax", model: "test-model", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result).toEqual(messages);
  });

  it("user message 的 content 不是 string 时应跳过", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "@test.txt" }], timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result).toEqual(messages);
  });

  it("不存在的 @ 引用应忽略", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "查看 @not-exist.txt", timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result).toEqual(messages);
  });

  it("混合消息应只处理 user message", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "查看 @test.txt", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 2, api: "anthropic-messages", provider: "minimax", model: "test-model", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" },
      { role: "user", content: "再看 @other.ts", timestamp: 3 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(5);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toMatchObject({
      role: "attachment",
      attachment: { type: "file", filePath: join(tempDir, "test.txt") },
    });
    expect(result[2]).toEqual(messages[1]);
    expect(result[3]).toEqual(messages[2]);
    expect(result[4]).toMatchObject({
      role: "attachment",
      attachment: { type: "file", filePath: join(tempDir, "other.ts") },
    });
  });

  it("目录 @ 引用应注入 directory attachment", async () => {
    const subDir = join(tempDir, "subdir");
    const fs = await import("node:fs");
    fs.mkdirSync(subDir);
    fs.writeFileSync(join(subDir, "a.txt"), "a");

    const messages: AgentMessage[] = [
      { role: "user", content: '查看 @"subdir"', timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(2);
    expect(result[1]).toMatchObject({
      role: "attachment",
      attachment: {
        type: "directory",
        path: subDir,
        displayPath: "subdir",
      },
    });
  });
});
