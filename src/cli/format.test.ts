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
} from "./format.js";

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
    expect(formatToolStart("Read", { file_path: "src/main.ts" })).toBe('-> Read(file_path: "src/main.ts")\n');
  });

  it("formatToolEnd 成功", () => {
    expect(formatToolEnd("Read", false, "1.2KB", 300)).toBe("OK Read -> 1.2KB 0.3s\n");
  });

  it("formatToolEnd 失败", () => {
    expect(formatToolEnd("Read", true, "ENOENT", 100)).toBe("ERR Read -> ENOENT 0.1s\n");
  });

  it("formatAICardEnd", () => {
    expect(formatAICardEnd(640, 0.000218, 800)).toBe("---\nTokens: 640 | Cost: $0.000218 | 0.8s\n");
  });
});
