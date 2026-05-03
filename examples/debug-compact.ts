import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "../src/agent/index.js";
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

export const DEFAULT_COMPACT_INSTRUCTIONS = "只保留当前任务、文件路径、错误和下一步";
const DEFAULT_MODEL_PROVIDER = "minimax-cn";
const DEFAULT_MODEL_ID = "MiniMax-M2.7-highspeed";

export interface DebugWorkspace {
  root: string;
  workspace: string;
  sessionBaseDir: string;
}

export interface DebugCompactArgs {
  instructions: string;
  help: boolean;
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

  mkdirSync(workspace, { recursive: true });
  mkdirSync(sessionBaseDir, { recursive: true });
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

export function formatCommandResult(result: ExecuteCommandResult): string[] {
  const lines = [
    `[COMPACT] handled=${result.handled} compact=${result.compact === true} skipPrompt=${result.skipPrompt === true}`,
  ];

  if (result.textResult) {
    lines.push(`[COMPACT] textResult: ${result.textResult}`);
  }
  if (result.compact === true) {
    lines.push("[COMPACT] command path: local compact result, no normal prompt dispatch");
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
      process.stdout.write(formatThinkingDelta(event.text));
      break;
    }
    case "answer_delta": {
      if (event.isFirst) {
        process.stdout.write(formatAnswerPrefix());
      }
      process.stdout.write(formatTextDelta(event.text));
      break;
    }
    case "tool_start": {
      if (event.isFirst) {
        process.stdout.write(formatToolsPrefix());
      }
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_end": {
      process.stdout.write(formatToolEnd(event.toolName, event.isError, event.summary, event.timeMs));
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
  const debugUiEvents: Array<{ type: "user" | "system"; text: string }> = [];
  const commandContext: CommandContext = {
    session,
    appendUserMessage: (text) => debugUiEvents.push({ type: "user", text }),
    appendSystemMessage: (text) => debugUiEvents.push({ type: "system", text }),
    resetSession: () => {
      throw new Error("resetSession is not supported in debug-compact");
    },
  };

  const commandInput = buildCompactCommandInput(instructions);
  console.log(`\n[COMPACT] executing ${commandInput}`);
  const result = await executeCommand(
    commandInput,
    commandContext,
    join(cwd, ".claude/skills"),
    cwd,
  );

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
  console.log(`[DEBUG] instructions: ${args.instructions}`);

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
}

if (import.meta.main) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      console.error("[ERROR]", error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
