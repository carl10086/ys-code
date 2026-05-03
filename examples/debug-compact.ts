import { readFileSync } from "node:fs";
import type { AgentMessage } from "../src/agent/types.js";

export const DEFAULT_COMPACT_INSTRUCTIONS = "只保留当前任务、文件路径、错误和下一步";

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

  console.log("[DEBUG] compact debug helper is ready.");
  console.log(`[DEBUG] instructions: ${args.instructions}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[ERROR]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
