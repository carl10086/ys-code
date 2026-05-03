import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEnvApiKey, getModel } from "../src/core/ai/index.js";
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
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[ERROR]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
