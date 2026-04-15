import { describe, it, expect } from "bun:test";
import {
  formatUserMessage,
  formatAICardStart,
  formatThinkingDelta,
  formatTextDelta,
  formatToolStart,
  formatToolEnd,
  formatAICardEnd,
  formatThinkingPrefix,
  formatAnswerPrefix,
  formatToolsPrefix,
} from "../format.js";

describe("format", () => {
  it("formatUserMessage", () => {
    expect(formatUserMessage("hello")).toBe("\n> hello\n");
  });

  it("formatAICardStart", () => {
    expect(formatAICardStart("test-model")).toBe("Assistant\n---\n");
  });

  it("formatThinkingPrefix", () => {
    expect(formatThinkingPrefix()).toBe("Thinking:\n  ");
  });

  it("formatThinkingDelta", () => {
    expect(formatThinkingDelta("think")).toBe("think");
  });

  it("formatThinkingDelta 多行保持缩进", () => {
    expect(formatThinkingDelta("line1\nline2")).toBe("line1\n  line2");
  });

  it("formatAnswerPrefix", () => {
    expect(formatAnswerPrefix()).toBe("\nAnswer:\n");
  });

  it("formatTextDelta", () => {
    expect(formatTextDelta("hi")).toBe("hi");
  });

  it("formatToolsPrefix", () => {
    expect(formatToolsPrefix()).toBe("\nTools:\n");
  });

  it("formatToolStart", () => {
    expect(formatToolStart("read_file", { path: "src/main.ts" })).toBe('-> read_file(path: "src/main.ts")\n');
  });

  it("formatToolEnd 成功", () => {
    expect(formatToolEnd("read_file", false, "1.2KB", 300)).toBe("OK read_file -> 1.2KB 0.3s\n");
  });

  it("formatToolEnd 失败", () => {
    expect(formatToolEnd("read_file", true, "ENOENT", 100)).toBe("ERR read_file -> ENOENT 0.1s\n");
  });

  it("formatAICardEnd", () => {
    expect(formatAICardEnd(640, 0.000218, 800)).toBe("---\nTokens: 640 | Cost: $0.000218 | 0.8s\n");
  });
});
