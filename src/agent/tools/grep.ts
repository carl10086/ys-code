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
  "-B": Type.Optional(Type.Number({ description: 'Number of lines to show before each match in "content" mode.' })),
  "-A": Type.Optional(Type.Number({ description: 'Number of lines to show after each match in "content" mode.' })),
  "-C": Type.Optional(Type.Number({ description: 'Number of lines to show before and after each match in "content" mode.' })),
  context: Type.Optional(Type.Number({ description: 'Alias for "-C" that takes precedence.' })),
  "-n": Type.Optional(Type.Boolean({ description: 'Show line numbers in "content" mode. Defaults to true.' })),
  "-i": Type.Optional(Type.Boolean({ description: "Case insensitive search." })),
  type: Type.Optional(Type.String({ description: "File type to search, e.g. ts, js, rust." })),
  head_limit: Type.Optional(Type.Number({ description: "Limit output entries. 0 means unlimited." })),
  offset: Type.Optional(Type.Number({ description: "Skip N entries before applying head_limit." })),
  multiline: Type.Optional(Type.Boolean({ description: "Enable multiline matching." })),
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
  appliedLimit: Type.Optional(Type.Number()),
  appliedOffset: Type.Optional(Type.Number()),
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

  if (params.multiline) {
    args.push("-U", "--multiline-dotall");
  }

  if (params["-i"]) {
    args.push("-i");
  }

  if (mode === "files_with_matches") {
    args.push("-l");
  } else if (mode === "count") {
    args.push("-c");
  } else {
    if (params["-n"] !== false) {
      args.push("-n");
    }
    const contextLines = params.context ?? params["-C"];
    if (contextLines !== undefined) {
      args.push("-C", String(contextLines));
    } else {
      if (params["-B"] !== undefined) {
        args.push("-B", String(params["-B"]));
      }
      if (params["-A"] !== undefined) {
        args.push("-A", String(params["-A"]));
      }
    }
  }

  if (params.type) {
    args.push("--type", params.type);
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

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset = 0,
): { items: T[]; appliedLimit?: number; appliedOffset?: number } {
  const start = Math.max(0, offset);
  if (limit === 0) {
    return {
      items: items.slice(start),
      ...(start > 0 && { appliedOffset: start }),
    };
  }

  if (limit === undefined) {
    return {
      items: items.slice(start),
      ...(start > 0 && { appliedOffset: start }),
    };
  }

  return {
    items: items.slice(start, start + limit),
    appliedLimit: limit,
    ...(start > 0 && { appliedOffset: start }),
  };
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
        const limited = applyHeadLimit(lines, params.head_limit, params.offset);
        const finalLines = limited.items.map((line) => relativizeContentLine(cwd, line));
        return {
          mode,
          numFiles: 0,
          filenames: [],
          content: finalLines.join("\n"),
          numLines: finalLines.length,
          ...(limited.appliedLimit !== undefined && { appliedLimit: limited.appliedLimit }),
          ...(limited.appliedOffset !== undefined && { appliedOffset: limited.appliedOffset }),
        };
      }

      if (mode === "count") {
        const limited = applyHeadLimit(lines, params.head_limit, params.offset);
        const countLines = limited.items.map((line) => {
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
          ...(limited.appliedLimit !== undefined && { appliedLimit: limited.appliedLimit }),
          ...(limited.appliedOffset !== undefined && { appliedOffset: limited.appliedOffset }),
        };
      }

      const relativeMatches = lines.map((line) => toRelative(cwd, line));
      const sortedMatches = await sortFilesByModifiedTime(cwd, relativeMatches);
      const limited = applyHeadLimit(sortedMatches, params.head_limit, params.offset);
      return {
        mode,
        numFiles: limited.items.length,
        filenames: limited.items,
        ...(limited.appliedLimit !== undefined && { appliedLimit: limited.appliedLimit }),
        ...(limited.appliedOffset !== undefined && { appliedOffset: limited.appliedOffset }),
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

    renderResult(output) {
      return {
        type: "search_result",
        mode: output.mode,
        numFiles: output.numFiles,
        filenames: output.filenames,
        ...(output.content !== undefined && { content: output.content }),
        ...(output.numLines !== undefined && { numLines: output.numLines }),
        ...(output.numMatches !== undefined && { numMatches: output.numMatches }),
      };
    },
  });
}
