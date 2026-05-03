import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AgentSession } from "../src/agent/index.js";
import type { AgentTool } from "../src/agent/types.js";
import {
  formatAICardEnd,
  formatAICardStart,
  formatAnswerPrefix,
  formatTextDelta,
  formatThinkingDelta,
  formatThinkingPrefix,
  formatToolEnd,
  formatToolStart,
  formatToolsPrefix,
  formatUserMessage,
} from "../src/cli/format.js";
import { executeCommand, type CommandContext, type ExecuteCommandResult } from "../src/commands/index.js";
import { getEnvApiKey, getModel } from "../src/core/ai/index.js";
import type { AgentSessionEvent } from "../src/agent/session.js";
import type { AgentMessage } from "../src/agent/types.js";
import { createReadTool } from "../src/agent/tools/index.js";
import { dispatchCommandResult } from "../src/tui/command-utils.js";
import stripAnsi from "strip-ansi";

// Usage: bun run examples/debug-compact.ts --instructions "只保留当前任务、文件路径、错误和下一步"
// The script intentionally keeps its temporary directory for transcript inspection.
export const DEFAULT_COMPACT_INSTRUCTIONS = "只保留当前任务、文件路径、错误和下一步";
const DEFAULT_MODEL_PROVIDER = "minimax-cn";
const DEFAULT_MODEL_ID = "MiniMax-M2.7-highspeed";
const MAX_TRANSCRIPT_DEBUG_BYTES = 1024 * 1024;

export interface DebugWorkspace {
  root: string;
  workspace: string;
  sessionBaseDir: string;
}

export interface DebugCompactArgs {
  instructions: string;
  help: boolean;
}

export interface DebugUiEvent {
  type: "user" | "system";
  text: string;
}

export function parseDebugCompactArgs(argv: readonly string[]): DebugCompactArgs {
  const args = [...argv];
  const help = args.includes("--help") || args.includes("-h");
  const instructionsIndex = args.indexOf("--instructions");
  const instructions = instructionsIndex >= 0
    ? args[instructionsIndex + 1]?.trim() || DEFAULT_COMPACT_INSTRUCTIONS
    : DEFAULT_COMPACT_INSTRUCTIONS;

  return { instructions, help };
}

export function createDebugWorkspace(): DebugWorkspace {
  const root = mkdtempSync(join(tmpdir(), "ys-code-compact-debug-"));
  const workspace = join(root, "workspace");
  const sessionBaseDir = join(root, "sessions");

  chmodSync(root, 0o700);
  mkdirSync(workspace, { recursive: true });
  mkdirSync(sessionBaseDir, { recursive: true });
  chmodSync(workspace, 0o700);
  chmodSync(sessionBaseDir, 0o700);
  writeFileSync(
    join(workspace, "compact-target.ts"),
    [
      "export function describeCompactTarget(input: string): string {",
      "  const normalized = input.trim().toLowerCase();",
      "  return `compact target: ${normalized}`;",
      "}",
      "",
      "export const compactDebugNotes = [",
      "  \"read this file before compact\",",
      "  \"preserve the active task and next step\",",
      "];",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(
    join(workspace, "notes.md"),
    [
      "# Compact Debug Notes",
      "",
      "- This temporary workspace is safe to inspect after the script exits.",
      "- The fixture intentionally avoids token-like or credential-like strings.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  return { root, workspace, sessionBaseDir };
}

export function buildSeedPrompt(): string {
  return [
    "请使用 Read 工具读取当前工作目录下的 compact-target.ts。",
    "然后用 3 条 bullet 总结这个文件的作用、后续 compact 时应该保留的上下文，以及下一步调试动作。",
    "不要修改文件。",
  ].join("\n");
}

export function buildCompactCommandInput(instructions: string): string {
  const trimmed = instructions.trim();
  return trimmed ? `/compact ${trimmed}` : "/compact";
}

export function sanitizeForDebugLog(text: string): string {
  return stripAnsi(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\b(MINIMAX_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(sk|xox[baprs]?)-[A-Za-z0-9-]{12,}\b/g, "[REDACTED_TOKEN]");
}

function isInsideDirectory(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function createDebugTools(workspace: string): AgentTool[] {
  const readTool = createReadTool(workspace);
  const originalValidateInput = readTool.validateInput;

  return [{
    ...readTool,
    description: `${readTool.description}\n\nDebug compact constraint: only read files inside the temporary debug workspace.`,
    validateInput: async (params, context) => {
      const filePath = typeof params.file_path === "string"
        ? params.file_path
        : "";
      let resolvedWorkspace: string;
      let resolvedTarget: string;
      try {
        resolvedWorkspace = realpathSync(workspace);
        resolvedTarget = realpathSync(resolve(workspace, filePath));
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          errorCode: 1,
        };
      }
      if (!isInsideDirectory(resolvedWorkspace, resolvedTarget)) {
        return {
          ok: false,
          message: `Debug compact Read is limited to workspace files: ${workspace}`,
          errorCode: 403,
        };
      }

      return originalValidateInput
        ? originalValidateInput(params, context)
        : { ok: true };
    },
  }];
}

export function formatCommandResult(result: ExecuteCommandResult): string[] {
  const lines = [
    `[COMPACT] handled=${result.handled} compact=${result.compact === true} skipPrompt=${result.skipPrompt === true}`,
  ];

  if (result.textResult) {
    lines.push(`[COMPACT] textResult: ${sanitizeForDebugLog(result.textResult)}`);
  }
  if (result.compact === true) {
    lines.push("[COMPACT] command path: local compact result, no normal prompt dispatch");
  }

  return lines;
}

export function assertCompactCommandResult(result: ExecuteCommandResult): void {
  if (result.handled === true && result.compact === true) {
    return;
  }

  const detail = result.textResult ? ` ${result.textResult}` : "";
  throw new Error(`Expected /compact to return a compact result, got handled=${result.handled} compact=${result.compact === true} skipPrompt=${result.skipPrompt === true}.${detail}`);
}

export function dispatchDebugCommandResult(
  result: ExecuteCommandResult,
  commandInput: string,
  session: AgentSession,
  debugUiEvents: DebugUiEvent[],
): boolean {
  return dispatchCommandResult(
    result,
    commandInput,
    session,
    (text) => debugUiEvents.push({ type: "user", text }),
    (text) => debugUiEvents.push({ type: "system", text }),
  );
}

export function formatPostCompactDetails(
  messages: readonly AgentMessage[],
  previewLength = 800,
): string[] {
  const lines: string[] = [];
  const boundary = messages.find((message) => message.role === "compact_boundary");
  if (boundary?.role === "compact_boundary") {
    lines.push(`[AFTER COMPACT] boundary metadata: ${JSON.stringify(boundary.compactMetadata)}`);
  } else {
    lines.push("[AFTER COMPACT] boundary metadata: not found");
  }

  const summary = messages.find((message) =>
    message.role === "user" && "isMeta" in message && message.isMeta === true
  );
  if (summary?.role === "user") {
    lines.push(`[AFTER COMPACT] summary preview: ${sanitizeForDebugLog(summaryPreview(textFromMessage(summary), previewLength))}`);
  } else {
    lines.push("[AFTER COMPACT] summary preview: not found");
  }

  const attachments = messages.filter((message) => message.role === "attachment");
  lines.push(`[AFTER COMPACT] attachments=${attachments.length}`);
  if (attachments.length === 0) {
    lines.push("  none");
  } else {
    attachments.forEach((message, index) => {
      if (message.role !== "attachment") return;
      const attachment = message.attachment;
      if (attachment.type === "file") {
        const linesCount = attachment.content.file?.numLines ?? 0;
        lines.push(`  ${index + 1}. file ${attachment.displayPath} lines=${linesCount}`);
      } else if (attachment.type === "directory") {
        lines.push(`  ${index + 1}. directory ${attachment.displayPath}`);
      } else {
        lines.push(`  ${index + 1}. ${attachment.type}`);
      }
    });
  }

  return lines;
}

export function formatMessageSummary(
  label: string,
  messages: readonly AgentMessage[],
): string[] {
  return [
    `[${label}] messages=${messages.length}`,
    ...messages.map((message, index) => {
      const meta = "isMeta" in message && message.isMeta ? " meta" : "";
      return `  ${index + 1}. ${message.role}${meta}`;
    }),
  ];
}

function textFromMessage(message: Extract<AgentMessage, { role: "user" | "assistant" }>): string {
  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("");
}

export function summaryPreview(text: string, maxLength = 800): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export function readTranscriptTailEntryTypes(
  filePath: string,
  count: number,
): string[] {
  if (count <= 0) return [];
  const stats = statSync(filePath);
  if (stats.size > MAX_TRANSCRIPT_DEBUG_BYTES) {
    return [`file_too_large:${stats.size}`];
  }
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const entryTypes: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown };
      if (typeof entry.type === "string") {
        entryTypes.push(entry.type);
      }
    } catch {
      // Corrupted transcript lines are expected during debugging; never echo them.
    }
  }

  return entryTypes.slice(-count);
}

export function findLatestTranscriptFile(sessionBaseDir: string): string | null {
  const files = readdirSync(sessionBaseDir)
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .map((fileName) => {
      const filePath = join(sessionBaseDir, fileName);
      return {
        fileName,
        filePath,
        mtimeMs: statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName));

  return files[0]?.filePath ?? null;
}

export function formatTranscriptDetails(
  sessionBaseDir: string,
  tailCount = 8,
): string[] {
  const sessionFile = findLatestTranscriptFile(sessionBaseDir);
  if (!sessionFile) {
    return ["[TRANSCRIPT] session file: not found"];
  }

  const tailTypes = readTranscriptTailEntryTypes(sessionFile, tailCount);
  return [
    `[TRANSCRIPT] session file: ${sessionFile}`,
    `[TRANSCRIPT] latest entry types: ${tailTypes.join(" -> ") || "none"}`,
  ];
}

function printHelp(): void {
  console.log(`Usage: bun run examples/debug-compact.ts [--instructions <text>]

Runs the compact debug example through the real slash command path.
`);
}

function subscribeToSessionEvents(session: AgentSession): void {
  session.subscribe((event) => {
    writeSessionEvent(event);
  });
}

function writeSessionEvent(event: AgentSessionEvent): void {
  switch (event.type) {
    case "turn_start": {
      process.stdout.write(formatAICardStart(event.modelName));
      break;
    }
    case "thinking_delta": {
      if (event.isFirst) {
        process.stdout.write(formatThinkingPrefix());
      }
      process.stdout.write(formatThinkingDelta(sanitizeForDebugLog(event.text)));
      break;
    }
    case "answer_delta": {
      if (event.isFirst) {
        process.stdout.write(formatAnswerPrefix());
      }
      process.stdout.write(formatTextDelta(sanitizeForDebugLog(event.text)));
      break;
    }
    case "tool_start": {
      if (event.isFirst) {
        process.stdout.write(formatToolsPrefix());
      }
      process.stdout.write(sanitizeForDebugLog(formatToolStart(event.toolName, event.args)));
      break;
    }
    case "tool_end": {
      process.stdout.write(sanitizeForDebugLog(formatToolEnd(event.toolName, event.isError, event.summary, event.timeMs)));
      break;
    }
    case "turn_end": {
      process.stdout.write(formatAICardEnd(event.tokens, event.cost, event.timeMs));
      break;
    }
  }
}

async function seedConversation(session: AgentSession): Promise<void> {
  const seedPrompt = buildSeedPrompt();
  console.log("\n[SETUP] running one real model turn to prepare compact context");
  process.stdout.write(formatUserMessage(seedPrompt));
  session.steer(seedPrompt);
  await session.prompt("");
}

async function runCompactCommand(
  session: AgentSession,
  instructions: string,
  cwd: string,
): Promise<ExecuteCommandResult> {
  const debugUiEvents: DebugUiEvent[] = [];
  const commandContext: CommandContext = {
    session,
    appendUserMessage: (text) => debugUiEvents.push({ type: "user", text }),
    appendSystemMessage: (text) => debugUiEvents.push({ type: "system", text }),
    resetSession: () => {
      throw new Error("resetSession is not supported in debug-compact");
    },
  };

  const commandInput = buildCompactCommandInput(instructions);
  console.log(`\n[COMPACT] executing ${sanitizeForDebugLog(commandInput)}`);
  const result = await executeCommand(
    commandInput,
    commandContext,
    join(cwd, ".claude/skills"),
    cwd,
  );

  dispatchDebugCommandResult(result, commandInput, session, debugUiEvents);
  assertCompactCommandResult(result);
  console.log(`[COMPACT] debug UI events captured=${debugUiEvents.length}`);
  return result;
}

async function main(): Promise<void> {
  const args = parseDebugCompactArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const debugWorkspace = createDebugWorkspace();
  console.log("[SETUP] compact debug workspace created");
  console.log(`[SETUP] debug root: ${debugWorkspace.root}`);
  console.log(`[SETUP] workspace: ${debugWorkspace.workspace}`);
  console.log(`[SETUP] sessionBaseDir: ${debugWorkspace.sessionBaseDir}`);
  console.log(`[DEBUG] instructions: ${sanitizeForDebugLog(args.instructions)}`);
  console.log("[SECURITY] This debug run keeps a local transcript; inspect it locally and avoid sharing it if prompts contain sensitive context.");

  const model = getModel(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID);
  const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error(`[ERROR] Missing API key for ${model.provider}. Set MINIMAX_API_KEY before running the real compact flow.`);
    process.exitCode = 1;
    return;
  }

  const session = new AgentSession({
    cwd: debugWorkspace.workspace,
    model,
    apiKey,
    sessionBaseDir: debugWorkspace.sessionBaseDir,
    tools: createDebugTools(debugWorkspace.workspace),
  });
  subscribeToSessionEvents(session);

  await seedConversation(session);
  for (const line of formatMessageSummary("BEFORE COMPACT", session.messages)) {
    console.log(line);
  }

  const commandResult = await runCompactCommand(
    session,
    args.instructions,
    debugWorkspace.workspace,
  );
  for (const line of formatCommandResult(commandResult)) {
    console.log(line);
  }
  console.log(`[COMPACT] first post-compact role: ${session.messages[0]?.role ?? "none"}`);
  for (const line of formatMessageSummary("AFTER COMPACT", session.messages)) {
    console.log(line);
  }
  for (const line of formatPostCompactDetails(session.messages)) {
    console.log(line);
  }
  for (const line of formatTranscriptDetails(debugWorkspace.sessionBaseDir)) {
    console.log(line);
  }
  console.log(`[DEBUG] debug root retained: ${debugWorkspace.root}`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      console.error("[ERROR]", error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
