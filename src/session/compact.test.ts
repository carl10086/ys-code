import { describe, it, expect } from "bun:test";
import { CompactTrigger } from "./compact.js";
import type { AgentMessage } from "../agent/types.js";

describe("CompactTrigger", () => {
  it("token 低于阈值时不触发 compact", () => {
    const trigger = new CompactTrigger({ threshold: 1000 });
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
    ];
    expect(trigger.shouldCompact(messages)).toBe(false);
  });

  it("token 超过阈值时应触发 compact", () => {
    const trigger = new CompactTrigger({ threshold: 10 });
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world this is a longer message" }], timestamp: 1 },
    ];
    expect(trigger.shouldCompact(messages)).toBe(true);
  });

  it("应生成 compact_boundary entry", () => {
    const trigger = new CompactTrigger({ threshold: 10 });
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world" }], timestamp: 1 },
    ];
    const boundary = trigger.createCompactBoundary(messages, "last-uuid");
    expect(boundary.type).toBe("compact_boundary");
    expect(boundary.parentUuid).toBe("last-uuid");
    expect(boundary.summary).toContain("Hello");
    expect(boundary.tokensBefore).toBeGreaterThan(0);
  });
});
