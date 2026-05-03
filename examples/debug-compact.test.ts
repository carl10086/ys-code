import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertCompactCommandResult,
  buildCompactCommandInput,
  buildSeedPrompt,
  createDebugTools,
  DEFAULT_COMPACT_INSTRUCTIONS,
  createDebugWorkspace,
  dispatchDebugCommandResult,
  findLatestTranscriptFile,
  formatMessageSummary,
  formatCommandResult,
  formatPostCompactDetails,
  formatTranscriptDetails,
  parseDebugCompactArgs,
  readTranscriptTailEntryTypes,
  sanitizeForDebugLog,
  summaryPreview,
} from "./debug-compact.js";
import type { AgentMessage } from "../src/agent/types.js";
import type { AgentSession } from "../src/agent/session.js";

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

  it("builds a seed prompt that asks the model to read the fixture file", () => {
    const prompt = buildSeedPrompt();

    expect(prompt).toContain("compact-target.ts");
    expect(prompt).toContain("Read");
    expect(prompt).toContain("不要修改文件");
  });

  it("builds a compact slash command with instructions", () => {
    expect(buildCompactCommandInput("只保留路径")).toBe("/compact 只保留路径");
    expect(buildCompactCommandInput("  ")).toBe("/compact");
  });

  it("formats compact command result and highlights local dispatch", () => {
    expect(formatCommandResult({
      handled: true,
      compact: true,
      textResult: "Compacted conversation.",
    })).toEqual([
      "[COMPACT] handled=true compact=true skipPrompt=false",
      "[COMPACT] textResult: Compacted conversation.",
      "[COMPACT] command path: local compact result, no normal prompt dispatch",
    ]);
  });

  it("dispatches compact results like the TUI without prompting the model", () => {
    const debugUiEvents: Array<{ type: "user" | "system"; text: string }> = [];
    const session = {
      prompt: () => {
        throw new Error("prompt should not be called for compact results");
      },
    } as unknown as AgentSession;

    const handled = dispatchDebugCommandResult(
      { handled: true, compact: true, textResult: "Compacted conversation." },
      "/compact",
      session,
      debugUiEvents,
    );

    expect(handled).toBe(true);
    expect(debugUiEvents).toEqual([
      { type: "user", text: "/compact" },
      { type: "system", text: "Compacted conversation." },
    ]);
  });

  it("rejects non-compact command results", () => {
    expect(() => assertCompactCommandResult({
      handled: true,
      skipPrompt: true,
      textResult: "Command failed. See logs for details.",
    })).toThrow("Expected /compact to return a compact result");
  });

  it("sanitizes control characters and common token shapes before logging", () => {
    expect(sanitizeForDebugLog("\u001b[31mTOKEN=secret-value Bearer abc.def.ghi\u001b[0m"))
      .toBe("TOKEN=[REDACTED] Bearer [REDACTED]");
  });

  it("formats post-compact boundary, summary, and attachment details", () => {
    const messages = [
      {
        role: "compact_boundary",
        uuid: "boundary-1",
        timestamp: 1,
        compactMetadata: { trigger: "manual", preTokens: 100, postTokens: 40 },
      },
      {
        role: "user",
        isMeta: true,
        content: [{ type: "text", text: "Summary:\nImportant compact summary content." }],
        timestamp: 2,
      },
      {
        role: "attachment",
        attachment: {
          type: "file",
          timestamp: 3,
          filePath: "/tmp/compact-target.ts",
          displayPath: "compact-target.ts",
          content: {
            type: "text",
            file: {
              filePath: "/tmp/compact-target.ts",
              content: "line 1\nline 2",
              numLines: 2,
              startLine: 1,
              totalLines: 2,
            },
          },
        },
        timestamp: 3,
      },
    ] as AgentMessage[];

    expect(formatPostCompactDetails(messages, 20)).toEqual([
      "[AFTER COMPACT] boundary metadata: {\"trigger\":\"manual\",\"preTokens\":100,\"postTokens\":40}",
      "[AFTER COMPACT] summary preview: Summary:\nImportant c...",
      "[AFTER COMPACT] attachments=1",
      "  1. file compact-target.ts lines=2",
    ]);
  });

  it("formats missing post-compact details explicitly", () => {
    expect(formatPostCompactDetails([])).toEqual([
      "[AFTER COMPACT] boundary metadata: not found",
      "[AFTER COMPACT] summary preview: not found",
      "[AFTER COMPACT] attachments=0",
      "  none",
    ]);
  });

  it("limits debug tools to read-only workspace access", async () => {
    const debugWorkspace = createDebugWorkspace();

    try {
      const tools = createDebugTools(debugWorkspace.workspace);
      expect(tools.map((tool) => tool.name)).toEqual(["Read"]);

      const readTool = tools[0];
      const outsideFile = join(debugWorkspace.root, "outside.txt");
      writeFileSync(outsideFile, "outside");
      const validation = await readTool.validateInput?.({
        file_path: outsideFile,
      }, {} as never);

      expect(validation).toEqual({
        ok: false,
        message: `Debug compact Read is limited to workspace files: ${debugWorkspace.workspace}`,
        errorCode: 403,
      });
    } finally {
      rmSync(debugWorkspace.root, { recursive: true, force: true });
    }
  });

  it("finds the latest transcript file and formats its tail entry types", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-code-debug-compact-session-"));
    const older = join(dir, "100_old.jsonl");
    const newer = join(dir, "200_new.jsonl");

    try {
      writeFileSync(older, `${JSON.stringify({ type: "header" })}\n`);
      writeFileSync(newer, [
        JSON.stringify({ type: "header" }),
        JSON.stringify({ type: "compact_boundary" }),
        JSON.stringify({ type: "user" }),
        JSON.stringify({ type: "user" }),
        "",
      ].join("\n"));

      expect(findLatestTranscriptFile(dir)).toBe(newer);
      expect(readTranscriptTailEntryTypes(newer, 0)).toEqual([]);
      expect(formatTranscriptDetails(dir, 3)).toEqual([
        `[TRANSCRIPT] session file: ${newer}`,
        "[TRANSCRIPT] latest entry types: compact_boundary -> user -> user",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
