import { describe, it, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Markdown } from "./Markdown.js";

describe("Markdown", () => {
  it("renders heading and text", () => {
    const { lastFrame } = render(
      <Markdown>{"# Hello\n\nThis is a paragraph."}</Markdown>
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Hello");
    expect(frame).toContain("This is a paragraph.");
  });

  it("renders table with borders", () => {
    const md = `| Name | Age |
|------|-----|
| Alice | 30  |`;
    const { lastFrame } = render(<Markdown>{md}</Markdown>);
    const frame = lastFrame()!;
    expect(frame).toContain("Name");
    expect(frame).toContain("Age");
    expect(frame).toContain("Alice");
    expect(frame).toContain("30");
    expect(frame).toContain("┌");
    expect(frame).toContain("┐");
    expect(frame).toContain("└");
    expect(frame).toContain("┘");
    expect(frame).toContain("│");
  });

  it("renders mixed content (text + table)", () => {
    const md = `Some text before.

| A | B |
|---|---|
| 1 | 2 |

Some text after.`;
    const { lastFrame } = render(<Markdown>{md}</Markdown>);
    const frame = lastFrame()!;
    expect(frame).toContain("Some text before.");
    expect(frame).toContain("Some text after.");
    expect(frame).toContain("A");
    expect(frame).toContain("B");
    expect(frame).toContain("1");
    expect(frame).toContain("2");
    expect(frame).toContain("┌");
    expect(frame).toContain("└");
  });
});
