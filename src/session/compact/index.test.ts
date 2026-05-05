import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "../../agent/types.js";
import {
  COMPACT_SUMMARY_SECTIONS,
  MICROCOMPACT_CLEARED_MESSAGE,
  compactConversation,
  isPromptTooLongError,
} from "./index.js";

const userMessage = (text: string, timestamp = 1): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp,
});

const validCompactSummary = () => `<summary>${COMPACT_SUMMARY_SECTIONS
  .map((section) => `${section}\nContent for ${section}`)
  .join("\n\n")}</summary>`;

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

describe("compactConversation", () => {
  it("runs microcompact before summary generation and returns post-compact messages", async () => {
    let runnerMessages: AgentMessage[] = [];
    const attachment = userMessage("attachment", 10);

    const result = await compactConversation({
      messages: [
        userMessage("hello", 1),
        toolResult("read-1", "Read", "very old read content ".repeat(20), 2),
      ],
      attachments: [attachment],
      keepRecentToolResults: 0,
      summaryRunner: async ({ messages }) => {
        runnerMessages = messages;
        return validCompactSummary();
      },
    });

    expect((runnerMessages[1] as any).content).toEqual([
      { type: "text", text: MICROCOMPACT_CLEARED_MESSAGE },
    ]);
    expect(result.boundaryMessage.role).toBe("compact_boundary");
    expect(result.summaryMessage.role).toBe("user");
    expect(result.attachments).toEqual([attachment]);
    expect(result.messagesToKeep).toEqual([]);
    expect(result.postCompactMessages).toEqual([
      result.boundaryMessage,
      result.summaryMessage,
      attachment,
    ]);
    expect(result.metrics.clearedToolCallIds).toEqual(["read-1"]);
    expect((result.boundaryMessage as any).compactMetadata.postTokens).toBe(result.metrics.postCompactTokens);
    expect(result.metrics.postCompactTokens).toBeGreaterThan(0);
    expect(result.displayText).toContain("Compacted");
  });

  it("retries with truncated messages when summary input is too long", async () => {
    const runnerMessageCounts: number[] = [];

    const result = await compactConversation({
      messages: [
        userMessage("one", 1),
        userMessage("two", 2),
        userMessage("three", 3),
        userMessage("four", 4),
      ],
      summaryRunner: async ({ messages }) => {
        runnerMessageCounts.push(messages.length);
        if (runnerMessageCounts.length === 1) {
          throw new Error("prompt is too long");
        }
        return validCompactSummary();
      },
    });

    expect(runnerMessageCounts).toEqual([4, 2]);
    expect(result.summaryMessage.role).toBe("user");
  });

  it("does not retry non prompt-too-long failures", async () => {
    await expect(compactConversation({
      messages: [userMessage("hello")],
      summaryRunner: async () => {
        throw new Error("network unavailable");
      },
    })).rejects.toThrow("network unavailable");
  });

  it("rejects compact summaries missing required sections", async () => {
    await expect(compactConversation({
      messages: [userMessage("hello")],
      summaryRunner: async () => "<summary>1. Primary Request and Intent:\nOnly one section.</summary>",
    })).rejects.toThrow("missing required sections");
  });

  it("records summary validation metadata for valid summaries", async () => {
    const result = await compactConversation({
      messages: [userMessage("hello")],
      summaryRunner: async () => validCompactSummary(),
    });

    expect((result.boundaryMessage as any).compactMetadata.summaryCheck).toEqual({
      ok: true,
      sectionCount: COMPACT_SUMMARY_SECTIONS.length,
      missingSections: [],
    });
  });
});

describe("isPromptTooLongError", () => {
  it("detects common prompt-too-long errors", () => {
    expect(isPromptTooLongError(new Error("maximum context length exceeded"))).toBe(true);
    expect(isPromptTooLongError(new Error("prompt is too long"))).toBe(true);
    expect(isPromptTooLongError(new Error("network unavailable"))).toBe(false);
  });
});
