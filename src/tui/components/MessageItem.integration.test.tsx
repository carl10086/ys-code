import { describe, it, expect } from "bun:test";
import chalk from "chalk";
import { render } from "ink-testing-library";
import { MessageItem } from "./MessageItem.js";
import type { UIMessage } from "../types.js";

// 强制 chalk 输出 ANSI 颜色
chalk.level = 3;

describe("MessageItem integration with Markdown", () => {
  it("renders text message with markdown formatting", () => {
    const message: UIMessage = {
      type: "text",
      text: "## Hello\n\nThis is **bold** and *italic*.",
    };
    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Answer:");
    expect(frame).toContain("Hello");
    expect(frame).toContain("bold");
    expect(frame).toContain("italic");
  });

  it("renders text message with markdown table", () => {
    const message: UIMessage = {
      type: "text",
      text: "| Name | Age |\n|------|-----|\n| Alice | 30 |",
    };
    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Answer:");
    expect(frame).toContain("Name");
    expect(frame).toContain("Age");
    expect(frame).toContain("Alice");
    expect(frame).toContain("30");
    expect(frame).toContain("┌");
    expect(frame).toContain("└");
  });

  it("renders thinking message with dimColor", () => {
    const message: UIMessage = {
      type: "thinking",
      text: "Let me think about **this**...",
    };
    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Thinking:");
    expect(frame).toContain("this");
  });

  it("renders user message unchanged", () => {
    const message: UIMessage = {
      type: "user",
      text: "Hello",
    };
    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("> Hello");
  });

  it("renders search_result files_with_matches summary and details", () => {
    const message: UIMessage = {
      type: "tool_end",
      toolName: "Grep",
      isError: false,
      summary: "fallback summary",
      timeMs: 123,
      renderData: {
        type: "search_result",
        mode: "files_with_matches",
        numFiles: 2,
        filenames: ["src/a.ts", "src/b.ts"],
      },
    };

    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Found 2 files");
    expect(frame).toContain("src/a.ts");
    expect(frame).toContain("src/b.ts");
    expect(frame).not.toContain("fallback summary");
  });

  it("renders search_result content summary and details", () => {
    const message: UIMessage = {
      type: "tool_end",
      toolName: "Grep",
      isError: false,
      summary: "fallback summary",
      timeMs: 123,
      renderData: {
        type: "search_result",
        mode: "content",
        numFiles: 0,
        filenames: [],
        content: "src/a.ts:1:target",
        numLines: 1,
      },
    };

    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Found 1 line");
    expect(frame).toContain("src/a.ts:1:target");
  });

  it("renders search_result count summary and details", () => {
    const message: UIMessage = {
      type: "tool_end",
      toolName: "Grep",
      isError: false,
      summary: "fallback summary",
      timeMs: 123,
      renderData: {
        type: "search_result",
        mode: "count",
        numFiles: 2,
        filenames: [],
        content: "src/a.ts:2\nsrc/b.ts:3",
        numMatches: 5,
      },
    };

    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Found 5 matches across 2 files");
    expect(frame).toContain("src/a.ts:2");
    expect(frame).toContain("src/b.ts:3");
  });
});
