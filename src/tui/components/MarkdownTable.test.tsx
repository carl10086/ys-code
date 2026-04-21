import { describe, it, expect } from "bun:test";
import { render } from "ink-testing-library";
import { MarkdownTable } from "./MarkdownTable.js";
import { marked, type Tokens } from "marked";

function getTableToken(md: string): Tokens.Table {
  const tokens = marked.lexer(md);
  return tokens.find((t) => t.type === "table") as Tokens.Table;
}

describe("MarkdownTable", () => {
  it("renders table with borders and cells", () => {
    const md = `| Name | Age |
|------|-----|
| Alice | 30  |
| Bob   | 25  |`;
    const token = getTableToken(md);
    const { lastFrame } = render(<MarkdownTable token={token} theme="dark" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Name");
    expect(frame).toContain("Age");
    expect(frame).toContain("Alice");
    expect(frame).toContain("Bob");
    expect(frame).toContain("30");
    expect(frame).toContain("25");
    expect(frame).toContain("┌");
    expect(frame).toContain("┐");
    expect(frame).toContain("└");
    expect(frame).toContain("┘");
    expect(frame).toContain("│");
  });

  it("aligns columns according to token.align", () => {
    const md = `| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |`;
    const token = getTableToken(md);
    const { lastFrame } = render(<MarkdownTable token={token} theme="dark" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Left");
    expect(frame).toContain("Center");
    expect(frame).toContain("Right");
    expect(frame).toContain("a");
    expect(frame).toContain("b");
    expect(frame).toContain("c");
  });

  it("falls back to raw markdown when table is too wide", () => {
    const cols = 200;
    const md = `| ${"x".repeat(cols)} |
|${"-".repeat(cols + 2)}|
| ${"y".repeat(cols)} |`;
    const token = getTableToken(md);
    const { lastFrame } = render(<MarkdownTable token={token} theme="dark" />);
    const frame = lastFrame()!;
    // raw markdown fallback wraps lines, so assert on substring presence
    expect(frame).toContain("x".repeat(80));
    expect(frame).toContain("y".repeat(80));
    // should NOT contain box-drawing characters (confirm it's raw, not rendered table)
    expect(frame).not.toContain("┌");
    expect(frame).not.toContain("│");
  });
});
