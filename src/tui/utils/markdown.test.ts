import { describe, it, expect } from "bun:test";
import chalk from "chalk";
import { formatToken, applyMarkdown } from "./markdown.js";
import type { Token } from "marked";

// 强制 chalk 输出 ANSI 颜色，确保测试在非 TTY 环境也能通过
chalk.level = 3;

describe("formatToken", () => {
  it("renders heading with bold", () => {
    const token: Token = {
      type: "heading",
      depth: 2,
      text: "Hello",
      raw: "## Hello",
      tokens: [{ type: "text", raw: "Hello", text: "Hello" }],
    } as Token;
    const result = formatToken(token, "dark");
    expect(result).toContain("\x1b[1m"); // bold ANSI
    expect(result).toContain("Hello");
  });

  it("renders codespan with theme color", () => {
    const token: Token = {
      type: "codespan",
      raw: "`code`",
      text: "code",
    } as Token;
    const result = formatToken(token, "dark");
    expect(result).toContain("code");
    expect(result).not.toBe("code"); // should have ANSI styling
  });

  it("renders paragraph with newline", () => {
    const token: Token = {
      type: "paragraph",
      raw: "Hello world",
      text: "Hello world",
      tokens: [{ type: "text", raw: "Hello world", text: "Hello world" }],
    } as Token;
    const result = formatToken(token, "dark");
    expect(result).toContain("Hello world");
    expect(result).toContain("\n");
  });
});

describe("applyMarkdown lists", () => {
  it("renders unordered list", () => {
    const result = applyMarkdown("- item 1\n- item 2", "dark");
    expect(result).toContain("• item 1");
    expect(result).toContain("• item 2");
  });

  it("renders ordered list", () => {
    const result = applyMarkdown("1. first\n2. second", "dark");
    expect(result).toContain("1. first");
    expect(result).toContain("2. second");
  });

  it("renders nested list", () => {
    const result = applyMarkdown("- outer\n  - inner", "dark");
    expect(result).toContain("• outer");
    expect(result).toContain("  • inner");
  });
});

describe("applyMarkdown", () => {
  it("renders basic markdown string", () => {
    const result = applyMarkdown("## Hello\n\nThis is a **test**.", "dark");
    expect(result).toContain("Hello");
    expect(result).toContain("test");
    expect(result).toContain("\x1b[1m"); // bold for heading and strong
  });
});
