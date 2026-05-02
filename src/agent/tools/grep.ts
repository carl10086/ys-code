import { Type, type Static } from "@sinclair/typebox";
import { stat } from "fs/promises";
import { relative, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const grepSchema = Type.Object({
  pattern: Type.String({ description: "The regular expression pattern to search for in file contents" }),
  path: Type.Optional(Type.String({
    description: "File or directory to search in. Defaults to the current working directory.",
  })),
  glob: Type.Optional(Type.String({
    description: 'Glob pattern to filter files, e.g. "*.ts" or "*.{ts,tsx}"',
  })),
  output_mode: Type.Optional(Type.Union([
    Type.Literal("content"),
    Type.Literal("files_with_matches"),
    Type.Literal("count"),
  ], {
    description: 'Output mode. Defaults to "files_with_matches".',
  })),
});

const grepOutputSchema = Type.Object({
  mode: Type.Union([
    Type.Literal("content"),
    Type.Literal("files_with_matches"),
    Type.Literal("count"),
  ]),
  numFiles: Type.Number(),
  filenames: Type.Array(Type.String()),
  content: Type.Optional(Type.String()),
  numLines: Type.Optional(Type.Number()),
  numMatches: Type.Optional(Type.Number()),
});

type GrepInput = Static<typeof grepSchema>;
type GrepOutput = Static<typeof grepOutputSchema>;

const DEFAULT_EXCLUDE_DIRS = [
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  ".jj",
  ".sl",
  "node_modules",
  "dist",
  "build",
];

function splitGlobPatterns(glob: string): string[] {
  return glob
    .split(/\s+/)
    .flatMap((part) => {
      if (part.includes("{") && part.includes("}")) {
        return [part];
      }
      return part.split(",");
    })
    .map((part) => part.trim())
    .filter(Boolean);
}

function toRelative(cwd: string, filePath: string): string {
  return relative(cwd, resolve(cwd, filePath));
}

function relativizeContentLine(cwd: string, line: string): string {
  const colonIndex = line.indexOf(":");
  if (colonIndex <= 0) {
    return line;
  }
  const filePath = line.slice(0, colonIndex);
  const rest = line.slice(colonIndex);
  return `${toRelative(cwd, filePath)}${rest}`;
}

async function runRipgrep(args: string[], cwd: string): Promise<string[]> {
  const proc = Bun.spawn(["rg", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    if (exitCode === 1 && !stderr.trim()) {
      return [];
    }
    throw new Error(`ripgrep failed: ${stderr || `exit code ${exitCode}`}`);
  }

  return stdout.split("\n").filter((line) => line.trim());
}

async function sortFilesByModifiedTime(cwd: string, filenames: string[]): Promise<string[]> {
  const stats = await Promise.allSettled(filenames.map((filename) => stat(resolve(cwd, filename))));
  return filenames
    .map((filename, index) => {
      const result = stats[index];
      return {
        filename,
        mtimeMs: result?.status === "fulfilled" ? result.value.mtimeMs : 0,
      };
    })
    .sort((a, b) => {
      if (process.env.NODE_ENV === "test") {
        return a.filename.localeCompare(b.filename);
      }
      const timeComparison = b.mtimeMs - a.mtimeMs;
      return timeComparison === 0 ? a.filename.localeCompare(b.filename) : timeComparison;
    })
    .map((entry) => entry.filename);
}

function createBaseArgs(params: GrepInput): string[] {
  const mode = params.output_mode ?? "files_with_matches";
  const args = ["--hidden", "--max-columns", "500"];

  if (mode === "files_with_matches") {
    args.push("-l");
  } else if (mode === "count") {
    args.push("-c");
  } else {
    args.push("-n");
  }

  if (params.pattern.startsWith("-")) {
    args.push("-e", params.pattern);
  } else {
    args.push(params.pattern);
  }

  if (params.glob) {
    for (const pattern of splitGlobPatterns(params.glob)) {
      args.push("--glob", pattern);
    }
  }

  for (const dir of DEFAULT_EXCLUDE_DIRS) {
    args.push("--glob", `!${dir}/**`);
  }

  args.push(params.path ?? ".");
  return args;
}

function formatLimitInfo(output: GrepOutput): string {
  const parts: string[] = [];
  if ("appliedLimit" in output && typeof output.appliedLimit === "number") {
    parts.push(`limit: ${output.appliedLimit}`);
  }
  if ("appliedOffset" in output && typeof output.appliedOffset === "number") {
    parts.push(`offset: ${output.appliedOffset}`);
  }
  return parts.join(", ");
}

export function createGrepTool(cwd: string): AgentTool<typeof grepSchema, GrepOutput> {
  return defineAgentTool({
    name: "Grep",
    label: "Grep",
    description: `A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command.
- Supports full regex syntax.
- Filter files with glob parameter (e.g. "*.js", "**/*.tsx").
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts.`,
    parameters: grepSchema,
    outputSchema: grepOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    validateInput: async (params: GrepInput) => {
      if (!params.path) {
        return { ok: true };
      }

      try {
        await stat(resolve(cwd, params.path));
        return { ok: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            ok: false,
            message: `Path does not exist: ${params.path}`,
            errorCode: 1,
          };
        }
        throw error;
      }
    },

    async execute(_toolCallId, params): Promise<GrepOutput> {
      const mode = params.output_mode ?? "files_with_matches";
      const lines = await runRipgrep(createBaseArgs(params), cwd);

      if (mode === "content") {
        const finalLines = lines.map((line) => relativizeContentLine(cwd, line));
        return {
          mode,
          numFiles: 0,
          filenames: [],
          content: finalLines.join("\n"),
          numLines: finalLines.length,
        };
      }

      if (mode === "count") {
        const countLines = lines.map((line) => {
          const colonIndex = line.lastIndexOf(":");
          if (colonIndex <= 0) {
            return line;
          }
          const filePath = line.slice(0, colonIndex);
          const count = line.slice(colonIndex);
          return `${toRelative(cwd, filePath)}${count}`;
        });

        let numMatches = 0;
        for (const line of countLines) {
          const colonIndex = line.lastIndexOf(":");
          const count = colonIndex > 0 ? Number.parseInt(line.slice(colonIndex + 1), 10) : Number.NaN;
          if (!Number.isNaN(count)) {
            numMatches += count;
          }
        }

        return {
          mode,
          numFiles: countLines.length,
          filenames: [],
          content: countLines.join("\n"),
          numMatches,
        };
      }

      const relativeMatches = lines.map((line) => toRelative(cwd, line));
      const filenames = await sortFilesByModifiedTime(cwd, relativeMatches);
      return {
        mode,
        numFiles: filenames.length,
        filenames,
      };
    },

    formatResult(output) {
      if (output.mode === "content") {
        const resultContent = output.content || "No matches found";
        const limitInfo = formatLimitInfo(output);
        return limitInfo
          ? `${resultContent}\n\n[Showing results with pagination = ${limitInfo}]`
          : resultContent;
      }

      if (output.mode === "count") {
        const rawContent = output.content || "No matches found";
        const matches = output.numMatches ?? 0;
        const files = output.numFiles ?? 0;
        return `${rawContent}\n\nFound ${matches} total ${matches === 1 ? "occurrence" : "occurrences"} across ${files} ${files === 1 ? "file" : "files"}.`;
      }

      if (output.numFiles === 0) {
        return "No files found";
      }

      return `Found ${output.numFiles} ${output.numFiles === 1 ? "file" : "files"}\n${output.filenames.join("\n")}`;
    },
  });
}
