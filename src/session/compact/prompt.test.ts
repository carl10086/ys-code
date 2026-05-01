import { describe, expect, it } from "bun:test";
import {
  COMPACT_SUMMARY_SECTIONS,
  formatCompactSummary,
  getCompactPrompt,
} from "./prompt.js";

describe("compact prompt", () => {
  it("wraps the prompt with no-tools instructions", () => {
    const prompt = getCompactPrompt();

    expect(prompt).toStartWith("You are summarizing a conversation. Do not use tools.");
    expect(prompt).toEndWith("Return only the final compact summary. Do not call any tools.");
  });

  it("includes all required summary sections", () => {
    const prompt = getCompactPrompt();

    for (const section of COMPACT_SUMMARY_SECTIONS) {
      expect(prompt).toContain(section);
    }
    expect(COMPACT_SUMMARY_SECTIONS).toHaveLength(9);
  });

  it("includes custom additional instructions when provided", () => {
    const prompt = getCompactPrompt({
      instructions: "只关注代码修改，忽略闲聊",
    });

    expect(prompt).toContain("Additional Instructions:");
    expect(prompt).toContain("只关注代码修改，忽略闲聊");
  });

  it("formats compact summary by removing analysis and keeping summary body", () => {
    const formatted = formatCompactSummary(`
<analysis>
private notes that should not survive
</analysis>
<summary>
1. Primary Request and Intent:
Implement compact.
</summary>
`);

    expect(formatted).toBe(`Summary:
1. Primary Request and Intent:
Implement compact.`);
    expect(formatted).not.toContain("private notes");
    expect(formatted).not.toContain("<summary>");
  });

  it("adds Summary prefix when model returns plain text", () => {
    expect(formatCompactSummary("Already concise")).toBe("Summary:\nAlready concise");
  });
});
