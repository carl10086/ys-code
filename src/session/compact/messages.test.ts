import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "../../agent/types.js";
import {
  buildPostCompactMessages,
  createCompactBoundaryMessage,
  createCompactSummaryMessage,
  getMessagesAfterCompactBoundary,
  isCompactBoundaryMessage,
} from "./messages.js";

const userMessage = (text: string, timestamp = 1): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp,
});

describe("compact message helpers", () => {
  it("creates compact boundary messages with manual trigger metadata", () => {
    const boundary = createCompactBoundaryMessage({
      trigger: "manual",
      preTokens: 1200,
      postTokens: 200,
      tokensSavedByMicrocompact: 300,
      clearedToolCallIds: ["tool-1"],
      parentUuid: "parent-1",
      timestamp: 123,
    });

    expect(isCompactBoundaryMessage(boundary)).toBe(true);
    expect(boundary.role).toBe("compact_boundary");
    expect(boundary.parentUuid).toBe("parent-1");
    expect(boundary.timestamp).toBe(123);
    expect(boundary.compactMetadata).toEqual({
      trigger: "manual",
      preTokens: 1200,
      postTokens: 200,
      tokensSavedByMicrocompact: 300,
      clearedToolCallIds: ["tool-1"],
    });
  });

  it("creates user meta summary messages", () => {
    const summary = createCompactSummaryMessage("Summary text", 456);

    expect(summary.role).toBe("user");
    if (summary.role !== "user") {
      throw new Error("Expected user summary message");
    }
    expect(summary.isMeta).toBe(true);
    expect(summary.timestamp).toBe(456);
    expect(summary.content).toEqual([{ type: "text", text: "Summary text" }]);
  });

  it("returns messages after the last compact boundary", () => {
    const firstBoundary = createCompactBoundaryMessage({ trigger: "manual", preTokens: 100, timestamp: 2 });
    const secondBoundary = createCompactBoundaryMessage({ trigger: "manual", preTokens: 200, timestamp: 4 });
    const after = userMessage("after", 5);

    expect(getMessagesAfterCompactBoundary([
      userMessage("before", 1),
      firstBoundary,
      userMessage("middle", 3),
      secondBoundary,
      after,
    ])).toEqual([after]);
  });

  it("builds post-compact messages in boundary, summary, keep, attachment order", () => {
    const boundary = createCompactBoundaryMessage({ trigger: "manual", preTokens: 100, timestamp: 1 });
    const summary = createCompactSummaryMessage("Summary", 2);
    const kept = userMessage("/compact", 3);
    const attachment = userMessage("attachment", 4);

    expect(buildPostCompactMessages({
      boundaryMessage: boundary,
      summaryMessage: summary,
      messagesToKeep: [kept],
      attachments: [attachment],
    })).toEqual([boundary, summary, kept, attachment]);
  });
});
