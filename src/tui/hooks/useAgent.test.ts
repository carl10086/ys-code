import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findLastUsage } from "./useAgent.js";
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
