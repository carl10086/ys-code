import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "../../agent/types.js";
import {
  COMPACTABLE_TOOLS,
  MICROCOMPACT_CLEARED_MESSAGE,
  microcompactMessages,
} from "./microcompact.js";

const toolResult = (
  toolCallId: string,
  toolName: string,
  text: string,
  timestamp = 1,
): AgentMessage => ({
  role: "toolResult",
  toolCallId,
  toolName,
  content: [{ type: "text", text }],
  isError: false,
  timestamp,
});

describe("microcompactMessages", () => {
  it("clears old compactable tool results while keeping recent results", () => {
    const messages = [
      toolResult("read-1", "Read", "old read content ".repeat(20), 1),
      toolResult("bash-1", "Bash", "old bash content ".repeat(20), 2),
      toolResult("web-1", "WebFetch", "recent web content ".repeat(20), 3),
    ];

    const result = microcompactMessages(messages, { keepRecent: 1 });

    expect(result.messages).toHaveLength(messages.length);
    expect(result.clearedToolCallIds).toEqual(["read-1", "bash-1"]);
    expect(result.keptToolCallIds).toEqual(["web-1"]);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect((result.messages[0] as any).content).toEqual([
      { type: "text", text: MICROCOMPACT_CLEARED_MESSAGE },
    ]);
    expect((result.messages[2] as any).content).toEqual((messages[2] as any).content);
  });

  it("does not clear non-compactable tool results", () => {
    const messages = [
      toolResult("skill-1", "Skill", "important skill output", 1),
      toolResult("read-1", "Read", "old read output", 2),
      toolResult("read-2", "Read", "recent read output", 3),
    ];

    const result = microcompactMessages(messages, { keepRecent: 1 });

    expect(result.clearedToolCallIds).toEqual(["read-1"]);
    expect(result.keptToolCallIds).toEqual(["skill-1", "read-2"]);
    expect((result.messages[0] as any).content).toEqual((messages[0] as any).content);
  });

  it("does not mutate the original messages", () => {
    const messages = [
      toolResult("read-1", "Read", "old read output", 1),
      toolResult("read-2", "Read", "recent read output", 2),
    ];

    const result = microcompactMessages(messages, { keepRecent: 1 });

    expect(result.messages).not.toBe(messages);
    expect((messages[0] as any).content).toEqual([{ type: "text", text: "old read output" }]);
  });

  it("clears all compactable results when keepRecent is zero", () => {
    const messages = [
      toolResult("read-1", "Read", "old read output", 1),
    ];

    const result = microcompactMessages(messages, { keepRecent: 0 });

    expect(result.clearedToolCallIds).toEqual(["read-1"]);
    expect(result.keptToolCallIds).toEqual([]);
  });

  it("exports the compactable tool whitelist", () => {
    expect(COMPACTABLE_TOOLS).toContain("Read");
    expect(COMPACTABLE_TOOLS).toContain("Bash");
    expect(COMPACTABLE_TOOLS).toContain("WebFetch");
  });
});
