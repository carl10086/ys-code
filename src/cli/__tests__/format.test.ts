import { describe, it, expect } from "bun:test";
import {
  formatUserMessage,
  formatAICardStart,
  formatThinkingDelta,
  formatTextDelta,
  formatToolStart,
  formatToolEnd,
  formatAICardEnd,
} from "../format.js";

describe("format", () => {
  it("formatUserMessage", () => {
    expect(formatUserMessage("hello")).toBe("\n> hello\n");
  });

  it("formatAICardStart", () => {
    expect(formatAICardStart("test-model")).toBe("Assistant\n---\n");
  });

  it("formatThinkingDelta", () => {
    expect(formatThinkingDelta("think")).toBe("> think");
  });

  it("formatTextDelta", () => {
    expect(formatTextDelta("hi")).toBe("hi");
  });

  it("formatToolStart", () => {
    expect(formatToolStart("read_file", { path: "src/main.ts" })).toBe('\n-> read_file(path: "src/main.ts")\n');
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
