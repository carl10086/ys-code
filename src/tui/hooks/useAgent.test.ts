import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findLastUsage, deriveUIMessages } from "./useAgent.js";
import type { AgentMessage } from "../../agent/types.js";
import type { Usage } from "../../core/ai/index.js";

function makeUsage(input: number, opts: Partial<Usage> = {}): Usage {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...opts,
  };
}

function makeAssistant(usage: Usage): AgentMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "minimax-cn",
    model: "test",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeUser(): AgentMessage {
  return {
    role: "user",
    content: "hi",
    timestamp: Date.now(),
  };
}

function makeToolResult(): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "Read",
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe("findLastUsage", () => {
  it("returns null for empty messages (resetSession 等价场景)", () => {
    expect(findLastUsage([])).toBeNull();
  });

  it("returns the prior assistant.usage on resume init", () => {
    const messages: AgentMessage[] = [
      makeUser(),
      makeAssistant(makeUsage(8000)),
    ];
    const usage = findLastUsage(messages);
    expect(usage?.input).toBe(8000);
  });

  it("does not accumulate across multiple turn_end events (returns last, not sum)", () => {
    const messages: AgentMessage[] = [
      makeUser(),
      makeAssistant(makeUsage(10000)),
      makeUser(),
      makeAssistant(makeUsage(20000)),
    ];
    const usage = findLastUsage(messages);
    expect(usage?.input).toBe(20000);
    expect(usage?.input).not.toBe(30000);
  });

  it("does not accumulate across tool-loop sub-turns (interleaved toolResult)", () => {
    const messages: AgentMessage[] = [
      makeUser(),
      makeAssistant(makeUsage(5000)),
      makeToolResult(),
      makeAssistant(makeUsage(8000)),
      makeToolResult(),
      makeAssistant(makeUsage(12000)),
    ];
    const usage = findLastUsage(messages);
    expect(usage?.input).toBe(12000);
  });

  it("preserves cacheRead and cacheWrite on the returned usage", () => {
    const messages: AgentMessage[] = [
      makeAssistant(
        makeUsage(5000, { cacheRead: 8000, cacheWrite: 2000, totalTokens: 15000 }),
      ),
    ];
    const usage = findLastUsage(messages);
    expect(usage?.input).toBe(5000);
    expect(usage?.cacheRead).toBe(8000);
    expect(usage?.cacheWrite).toBe(2000);
  });
});

describe("useAgent cost accumulator (source invariant)", () => {
  // 防回归：cost 累加逻辑未被本次 totalTokens→lastUsage 重命名误改。
  // 由于无 React hook 测试框架，这里以源码 invariant 锁定关键行。
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "useAgent.ts"), "utf8");

  it("retains setCost((prev) => prev + event.cost) in turn_end branch", () => {
    expect(src).toContain("setCost((prev) => prev + event.cost)");
  });

  it("retains setLastUsage read-back from session.messages", () => {
    expect(src).toContain("setLastUsage(findLastUsage(sessionRef.current.messages))");
    // 防止有人改回累加：禁止 setLastUsage((prev) => ...) 形式
    expect(src).not.toMatch(/setLastUsage\(\s*\(?prev/);
  });

  it("keeps setMessages updater pure (no setState calls inside)", () => {
    // 切片：从 setMessages((prev) => { 起到对应的 }); 止
    const start = src.indexOf("setMessages((prev) => {");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start);
    // 找到匹配的闭合 }); —— 用括号深度计数
    let depth = 0;
    let end = -1;
    for (let i = 0; i < tail.length; i++) {
      const ch = tail[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    expect(end).toBeGreaterThan(-1);
    const updaterBody = tail.slice(0, end);
    // updater 内不应触发其他 setState（React 反模式）
    expect(updaterBody).not.toContain("setLastUsage(");
    expect(updaterBody).not.toContain("setCost(");
    expect(updaterBody).not.toContain("setShouldScrollToBottom(");
  });
});

describe("deriveUIMessages", () => {
  it("should convert user messages to UI user messages", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 },
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toEqual({ type: "user", text: "Hello" });
  });

  it("should skip meta user messages", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "meta", isMeta: true, timestamp: 1000 },
      { role: "user", content: "normal", timestamp: 1001 },
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toEqual({ type: "user", text: "normal" });
  });

  it("should convert assistant message with text", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-test",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 1000,
      },
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(3);
    expect(ui[0]).toEqual({ type: "assistant_start" });
    expect(ui[1]).toEqual({ type: "text", text: "Hi there" });
    expect(ui[2]).toEqual({ type: "assistant_end", tokens: 2, cost: 0, timeMs: 0 });
  });

  it("should pair toolCall with toolResult", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read" },
          { type: "toolCall", id: "t1", name: "Read", arguments: { filePath: "/test.txt" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-test",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: 1000,
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "Read",
        content: [{ type: "text", text: "file content" }],
        isError: false,
        timestamp: 1001,
      },
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(5);
    expect(ui[0]).toEqual({ type: "assistant_start" });
    expect(ui[1]).toEqual({ type: "text", text: "Let me read" });
    expect(ui[2]).toEqual({ type: "tool_start", toolName: "Read", args: { filePath: "/test.txt" } });
    expect(ui[3]).toEqual({ type: "tool_end", toolName: "Read", isError: false, summary: "file content", timeMs: 0, renderData: undefined });
    expect(ui[4]).toEqual({ type: "assistant_end", tokens: 15, cost: 0, timeMs: 0 });
  });

  it("should skip attachment and compact_boundary entries", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 },
      { role: "attachment", attachment: { type: "skill_listing" }, timestamp: 1001 } as AgentMessage,
      { role: "compact_boundary", uuid: "c1", timestamp: 1002 } as AgentMessage,
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toEqual({ type: "user", text: "Hello" });
  });

  it("should extract text from array content", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }], timestamp: 1000 },
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toEqual({ type: "user", text: "Hello world" });
  });

  it("should produce empty array for compact-only messages", () => {
    const messages: AgentMessage[] = [
      { role: "compact_boundary", uuid: "c1", timestamp: 1000 } as AgentMessage,
      { role: "user", content: "Summary", isMeta: true, timestamp: 1001 },
    ];

    const ui = deriveUIMessages(messages);
    expect(ui).toHaveLength(0);
  });

  it("should pass renderData from toolResult to tool_end UI message", () => {
    const renderData = { type: "todo_list", oldTodos: [], newTodos: [{ content: "A", status: "pending", activeForm: "A" }] };
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "TodoWrite", arguments: { todos: [{ content: "A", status: "pending" }] } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-test",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: 1000,
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "TodoWrite",
        content: [{ type: "text", text: "done" }],
        isError: false,
        timestamp: 1001,
        renderData,
      },
    ];

    const ui = deriveUIMessages(messages);
    const toolEnd = ui.find((m) => m.type === "tool_end");
    expect(toolEnd).toBeDefined();
    expect((toolEnd as any).renderData).toEqual(renderData);
  });
});
