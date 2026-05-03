import { afterAll, describe, it, expect } from "bun:test";
import chalk from "chalk";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { render } from "ink-testing-library";
import { join } from "path";
import { tmpdir } from "os";
import { MessageItem } from "./MessageItem.js";
import type { UIMessage } from "../types.js";
import { createGrepTool } from "../../agent/tools/grep.js";

// 强制 chalk 输出 ANSI 颜色
const originalChalkLevel = chalk.level;
chalk.level = 3;
afterAll(() => {
  chalk.level = originalChalkLevel;
});

function mockContext(): any {
  return {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    fileStateCache: {},
  };
}

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

  it("renders Glob search_result summary and truncation details", () => {
    const message: UIMessage = {
      type: "tool_end",
      toolName: "Glob",
      isError: false,
      summary: "fallback summary",
      timeMs: 123,
      renderData: {
        type: "search_result",
        mode: "files_with_matches",
        numFiles: 1,
        filenames: ["src/a.ts"],
        appliedLimit: 100,
        truncated: true,
      },
    };

    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("Glob");
    expect(frame).toContain("Found 1 file (limit 100, truncated)");
    expect(frame).toContain("src/a.ts");
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

  it("strips ANSI control sequences from search_result details", () => {
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
        content: "src/a.ts:1:\x1b[31mtarget\x1b[0m",
        numLines: 1,
      },
    };

    const { lastFrame } = render(<MessageItem message={message} />);
    const frame = lastFrame()!;

    expect(frame).toContain("src/a.ts:1:target");
    expect(frame).not.toContain("\x1b[31m");
    expect(frame).not.toContain("\x1b[0m");
  });

  it("strips control sequences from tool args, plain render text, and fallback summary", () => {
    const toolStart: UIMessage = {
      type: "tool_start",
      toolName: "\x1b]8;;https://example.com\x07Grep\x1b]8;;\x07",
      args: { pattern: "\x1b[31mtarget\x1b[0m" },
    };
    const plain: UIMessage = {
      type: "tool_end",
      toolName: "Read",
      isError: false,
      summary: "fallback",
      timeMs: 123,
      renderData: { type: "plain", text: "\x1b[31mplain\x1b[0m" },
    };
    const fallback: UIMessage = {
      type: "tool_end",
      toolName: "Grep",
      isError: true,
      summary: "\x1b]8;;https://example.com\x07error\x1b]8;;\x07",
      timeMs: 123,
    };

    expect(render(<MessageItem message={toolStart} />).lastFrame()!).toContain("target");
    expect(render(<MessageItem message={toolStart} />).lastFrame()!).not.toContain("\x1b[31m");
    expect(render(<MessageItem message={toolStart} />).lastFrame()!).toContain("Grep");
    expect(render(<MessageItem message={toolStart} />).lastFrame()!).not.toContain("\x1b]8");
    expect(render(<MessageItem message={plain} />).lastFrame()!).toContain("plain");
    expect(render(<MessageItem message={plain} />).lastFrame()!).not.toContain("\x1b[31m");
    expect(render(<MessageItem message={fallback} />).lastFrame()!).toContain("error");
    expect(render(<MessageItem message={fallback} />).lastFrame()!).not.toContain("\x1b]8");
  });

  it("strips unterminated OSC sequences after long tool args are truncated", () => {
    const message: UIMessage = {
      type: "tool_start",
      toolName: "Grep",
      args: {
        pattern: `safe \x1b]8;;https://example.com/${"a".repeat(200)}`,
      },
    };

    const frame = render(<MessageItem message={message} />).lastFrame()!;

    expect(frame).toContain("Grep");
    expect(frame).toContain("safe");
    expect(frame).not.toContain("\x1b]8");
    expect(frame).not.toContain("https://example.com");
  });

  it("strips control sequences from structured_diff file paths and lines", () => {
    const message: UIMessage = {
      type: "tool_end",
      toolName: "Edit",
      isError: false,
      summary: "fallback",
      timeMs: 123,
      renderData: {
        type: "structured_diff",
        filePath: "\x1b]8;;https://example.com\x07src/a.ts\x1b]8;;\x07",
        hunks: [{
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-\x1b[31mold\x1b[0m", "+\x1b]8;;https://example.com\x07new\x1b]8;;\x07"],
        }],
      },
    };

    const frame = render(<MessageItem message={message} />).lastFrame()!;

    expect(frame).toContain("src/a.ts");
    expect(frame).toContain("-old");
    expect(frame).toContain("+new");
    expect(frame).not.toContain("\x1b]8");
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

  it("renders search_result pagination and truncation metadata", () => {
    const message: UIMessage = {
      type: "tool_end",
      toolName: "Grep",
      isError: false,
      summary: "fallback summary",
      timeMs: 123,
      renderData: {
        type: "search_result",
        mode: "count",
        numFiles: 5,
        filenames: [],
        content: "src/a.ts:1",
        numMatches: 5,
        appliedLimit: 5,
        appliedOffset: 250,
        truncated: true,
        truncatedReason: "line_limit",
      },
    };

    const frame = render(<MessageItem message={message} />).lastFrame()!;

    expect(frame).toContain("Found 5 matches across 5 files");
    expect(frame).toContain("limit 5");
    expect(frame).toContain("offset 250");
    expect(frame).toContain("truncated: line_limit");
  });

  it("renders real GrepTool content and count renderData", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ys-grep-message-"));
    try {
      await writeFile(join(dir, "alpha.ts"), "target\n", "utf-8");
      const tool = createGrepTool(dir);

      const contentOutput = await tool.execute("grep-content-render", {
        pattern: "target",
        output_mode: "content",
      }, mockContext());
      const countOutput = await tool.execute("grep-count-render", {
        pattern: "target",
        output_mode: "count",
      }, mockContext());
      const contentRenderData = tool.renderResult!(contentOutput, "grep-content-render");
      const countRenderData = tool.renderResult!(countOutput, "grep-count-render");

      expect(contentRenderData).not.toBeNull();
      expect(countRenderData).not.toBeNull();

      const contentMessage: UIMessage = {
        type: "tool_end",
        toolName: "Grep",
        isError: false,
        summary: "fallback",
        timeMs: 123,
        renderData: contentRenderData ?? undefined,
      };
      const countMessage: UIMessage = {
        type: "tool_end",
        toolName: "Grep",
        isError: false,
        summary: "fallback",
        timeMs: 123,
        renderData: countRenderData ?? undefined,
      };

      expect(render(<MessageItem message={contentMessage} />).lastFrame()!).toContain("Found 1 line");
      expect(render(<MessageItem message={contentMessage} />).lastFrame()!).toContain("alpha.ts:1:target");
      expect(render(<MessageItem message={countMessage} />).lastFrame()!).toContain("Found 1 match across 1 file");
      expect(render(<MessageItem message={countMessage} />).lastFrame()!).toContain("alpha.ts:1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
