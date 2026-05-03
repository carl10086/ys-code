import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_COMPACT_INSTRUCTIONS,
  createDebugWorkspace,
  formatMessageSummary,
  parseDebugCompactArgs,
  readTranscriptTailEntryTypes,
  summaryPreview,
} from "./debug-compact.js";
import type { AgentMessage } from "../src/agent/types.js";

describe("debug-compact helpers", () => {
  it("uses default instructions when no arguments are provided", () => {
    expect(parseDebugCompactArgs([])).toEqual({
      instructions: DEFAULT_COMPACT_INSTRUCTIONS,
      help: false,
    });
  });

  it("parses Chinese instructions containing spaces", () => {
    expect(parseDebugCompactArgs([
      "--instructions",
      "只保留 当前任务、文件路径、错误 和 下一步",
    ])).toEqual({
      instructions: "只保留 当前任务、文件路径、错误 和 下一步",
      help: false,
    });
  });

  it("formats message roles and meta markers", () => {
    const messages = [
      {
        role: "user",
        isMeta: true,
        content: [{ type: "text", text: "summary" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
        timestamp: 2,
      },
    ] as AgentMessage[];

    expect(formatMessageSummary("BEFORE", messages)).toEqual([
      "[BEFORE] messages=2",
      "  1. user meta",
      "  2. assistant",
    ]);
  });

  it("truncates long summary previews", () => {
    expect(summaryPreview("abcdef", 4)).toBe("abcd...");
    expect(summaryPreview("abc", 4)).toBe("abc");
  });

  it("reads the last transcript entry types and skips corrupted lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-code-debug-compact-test-"));
    const filePath = join(dir, "session.jsonl");

    try {
      writeFileSync(
        filePath,
        [
          JSON.stringify({ type: "header" }),
          "not json",
          JSON.stringify({ type: "user" }),
          JSON.stringify({ type: "compact_boundary" }),
          JSON.stringify({ type: "assistant" }),
          "",
        ].join("\n"),
      );

      expect(readTranscriptTailEntryTypes(filePath, 2)).toEqual([
        "compact_boundary",
        "assistant",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates an isolated workspace with debug fixture files", () => {
    const debugWorkspace = createDebugWorkspace();

    try {
      expect(debugWorkspace.root).toContain("ys-code-compact-debug-");
      expect(debugWorkspace.workspace).toBe(join(debugWorkspace.root, "workspace"));
      expect(debugWorkspace.sessionBaseDir).toBe(join(debugWorkspace.root, "sessions"));
      expect(existsSync(join(debugWorkspace.workspace, "compact-target.ts"))).toBe(true);
      expect(existsSync(join(debugWorkspace.workspace, "notes.md"))).toBe(true);
      expect(readFileSync(join(debugWorkspace.workspace, "compact-target.ts"), "utf-8"))
        .toContain("export function describeCompactTarget");
    } finally {
      rmSync(debugWorkspace.root, { recursive: true, force: true });
    }
  });
});
