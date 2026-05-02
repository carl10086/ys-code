import { Type, type Static } from "@sinclair/typebox";
import { realpath, stat } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool, ToolUseContext } from "../types.js";

const grepSchema = Type.Object({
  pattern: Type.String({ maxLength: 8192, description: "The regular expression pattern to search for in file contents" }),
  path: Type.Optional(Type.String({
    maxLength: 4096,
    description: "File or directory to search in. Defaults to the current working directory.",
  })),
  glob: Type.Optional(Type.String({
    maxLength: 8192,
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
  type: Type.Optional(Type.String({ maxLength: 128, description: "File type to search, e.g. ts, js, rust." })),
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
  truncated: Type.Optional(Type.Boolean()),
  truncatedReason: Type.Optional(Type.Union([
    Type.Literal("line_limit"),
    Type.Literal("byte_limit"),
    Type.Literal("timeout"),
  ])),
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
const DEFAULT_EXCLUDE_FILES = [
  ".env",
  ".env.*",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".yarnrc",
  ".aws/**",
  ".ssh/**",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*credentials*",
  "*secret*",
];
const DEFAULT_HEAD_LIMIT = 250;
const MAX_OUTPUT_LINES = 5000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_CONTEXT_LINES = 50;
const DEFAULT_TIMEOUT_MS = 30_000;

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

function isInsideDirectory(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function validateNonNegativeInteger(value: number | undefined, name: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    return `${name} must be a non-negative integer`;
  }
  return null;
}

function validateIntegerMaximum(value: number | undefined, name: string, maximum: number): string | null {
  if (value !== undefined && value > maximum) {
    return `${name} must be at most ${maximum}`;
  }
  return null;
}

function validateMaxLength(value: string | undefined, name: string, maxLength: number): string | null {
  if (value !== undefined && value.length > maxLength) {
    return `${name} must be at most ${maxLength} characters`;
  }
  return null;
}

async function validateGrepInput(params: GrepInput, cwd: string): Promise<
  | { ok: true; searchPath: string }
  | { ok: false; message: string; errorCode?: number }
> {
  for (const [name, value, maxLength] of [
    ["pattern", params.pattern, 8192],
    ["path", params.path, 4096],
    ["glob", params.glob, 8192],
    ["type", params.type, 128],
  ] as const) {
    const message = validateMaxLength(value, name, maxLength);
    if (message) {
      return { ok: false, message, errorCode: 1 };
    }
  }

  for (const [name, value] of [
    ["head_limit", params.head_limit],
    ["offset", params.offset],
    ["-A", params["-A"]],
    ["-B", params["-B"]],
    ["-C", params["-C"]],
    ["context", params.context],
  ] as const) {
    const message = validateNonNegativeInteger(value, name);
    if (message) {
      return { ok: false, message, errorCode: 1 };
    }
  }

  for (const [name, value, maximum] of [
    ["head_limit", params.head_limit, MAX_OUTPUT_LINES],
    ["offset", params.offset, MAX_OUTPUT_LINES],
    ["-A", params["-A"], MAX_CONTEXT_LINES],
    ["-B", params["-B"], MAX_CONTEXT_LINES],
    ["-C", params["-C"], MAX_CONTEXT_LINES],
    ["context", params.context, MAX_CONTEXT_LINES],
  ] as const) {
    const message = validateIntegerMaximum(value, name, maximum);
    if (message) {
      return { ok: false, message, errorCode: 1 };
    }
  }

  if (!params.path) {
    return { ok: true, searchPath: "." };
  }

  if (isAbsolute(params.path)) {
    return {
      ok: false,
      message: `Path must be relative to the workspace: ${params.path}`,
      errorCode: 1,
    };
  }

  const resolvedPath = resolve(cwd, params.path);
  try {
    await stat(resolvedPath);
    const [realCwd, realTarget] = await Promise.all([realpath(cwd), realpath(resolvedPath)]);
    if (!isInsideDirectory(realCwd, realTarget)) {
      return {
        ok: false,
        message: `Path is outside the workspace: ${params.path}`,
        errorCode: 1,
      };
    }

    return { ok: true, searchPath: realTarget };
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
}

function relativizeContentLine(cwd: string, line: string): string {
  const cwdPrefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (line.startsWith(cwdPrefix)) {
    return line.slice(cwdPrefix.length);
  }

  const colonIndex = line.indexOf(":");
  if (colonIndex <= 0) {
    return line;
  }
  const filePath = line.slice(0, colonIndex);
  const rest = line.slice(colonIndex);
  return `${toRelative(cwd, filePath)}${rest}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Grep search aborted");
  }
}

async function readLimitedLines(
  stream: ReadableStream<Uint8Array>,
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
  signal?: AbortSignal,
  maxLines?: number,
  maxBytes = MAX_OUTPUT_BYTES,
): Promise<{ lines: string[]; truncated: boolean; truncatedReason?: "line_limit" | "byte_limit" }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let pending = "";
  let bytesRead = 0;

  const pushLine = (line: string): boolean => {
    if (line.trim()) {
      if (maxLines !== undefined && lines.length >= maxLines) {
        proc.kill();
        return true;
      }
      lines.push(line);
    }
    return false;
  };

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      proc.kill();
      await reader.cancel();
      return { lines, truncated: true, truncatedReason: "byte_limit" };
    }

    pending += decoder.decode(value, { stream: true });
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      if (pushLine(line)) {
        await reader.cancel();
        return { lines, truncated: true, truncatedReason: "line_limit" };
      }
      newlineIndex = pending.indexOf("\n");
    }
  }

  pending += decoder.decode();
  if (pending && pushLine(pending)) {
    return { lines, truncated: true, truncatedReason: "line_limit" };
  }

  return { lines, truncated: false };
}

async function readLimitedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes = MAX_STDERR_BYTES,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (bytesRead + value.byteLength > maxBytes) {
      const remaining = Math.max(0, maxBytes - bytesRead);
      if (remaining > 0) {
        chunks.push(decoder.decode(value.slice(0, remaining), { stream: true }));
      }
      await reader.cancel();
      return { text: `${chunks.join("")}\n[stderr truncated after ${maxBytes} bytes]`, truncated: true };
    }

    bytesRead += value.byteLength;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return { text: chunks.join(""), truncated: false };
}

async function runRipgrep(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  maxLines?: number,
): Promise<{ lines: string[]; truncated: boolean; truncatedReason?: "line_limit" | "byte_limit" | "timeout" }> {
  throwIfAborted(signal);
  const proc = Bun.spawn(["rg", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let aborted = false;
  let timedOut = false;
  const abort = () => {
    aborted = true;
    proc.kill();
  };
  const timeoutMs = Number.parseInt(process.env.YS_GREP_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);

  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) {
      abort();
    }
    const stderrPromise = readLimitedText(proc.stderr);
    const { lines, truncated, truncatedReason } = await readLimitedLines(proc.stdout, proc, signal, maxLines);
    const exitCode = await proc.exited;
    const { text: stderr } = await stderrPromise;

    if (aborted || signal?.aborted) {
      throw new Error("Grep search aborted");
    }

    if (timedOut) {
      return { lines, truncated: true, truncatedReason: "timeout" };
    }

    if (truncated) {
      return { lines, truncated, truncatedReason };
    }

    if (exitCode !== 0) {
      if (exitCode === 1 && !stderr.trim()) {
        return { lines: [], truncated: false };
      }
      throw new Error(`ripgrep failed: ${stderr || `exit code ${exitCode}`}`);
    }

    return { lines, truncated: false };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
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
    if (process.env.NODE_ENV !== "test") {
      args.push("--sortr", "modified");
    }
  } else if (mode === "count") {
    args.push("-c", "--with-filename");
  } else {
    args.push("--with-filename");
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
  for (const file of DEFAULT_EXCLUDE_FILES) {
    args.push("--glob", `!${file}`);
  }

  args.push("--", params.path ?? ".");
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

function formatTruncationInfo(output: GrepOutput): string {
  const parts: string[] = [];
  const limitInfo = formatLimitInfo(output);
  if (limitInfo) {
    parts.push(limitInfo);
  }
  if (output.truncated) {
    parts.push(`truncated${output.truncatedReason ? `: ${output.truncatedReason}` : ""}`);
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

  const limitedItems = items.slice(start, start + limit);
  return {
    items: limitedItems,
    ...(limitedItems.length === limit && { appliedLimit: limit }),
    ...(start > 0 && { appliedOffset: start }),
  };
}

function getEffectiveMaxLines(headLimit: number, offset: number | undefined): number | undefined {
  if (headLimit === 0) {
    return MAX_OUTPUT_LINES;
  }
  return Math.min((offset ?? 0) + headLimit, MAX_OUTPUT_LINES);
}

function getCapLimit(
  truncated: boolean,
  truncatedReason: "line_limit" | "byte_limit" | "timeout" | undefined,
  headLimit: number,
): number | undefined {
  if (!truncated) {
    return undefined;
  }
  if (headLimit === 0 || truncatedReason === "byte_limit" || truncatedReason === "timeout") {
    return MAX_OUTPUT_LINES;
  }
  return undefined;
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

    validateInput: async (params: GrepInput) => validateGrepInput(params, cwd),

    async execute(_toolCallId, params, context: ToolUseContext): Promise<GrepOutput> {
      const validation = await validateGrepInput(params, cwd);
      if (!validation.ok) {
        throw new Error(validation.message);
      }

      const mode = params.output_mode ?? "files_with_matches";
      const headLimit = params.head_limit ?? DEFAULT_HEAD_LIMIT;
      const maxLines = getEffectiveMaxLines(headLimit, params.offset);
      const executionCwd = await realpath(cwd);
      const searchParams = { ...params, path: validation.searchPath };
      const { lines, truncated, truncatedReason } = await runRipgrep(
        createBaseArgs(searchParams),
        executionCwd,
        context.abortSignal,
        maxLines,
      );
      const capLimit = getCapLimit(truncated, truncatedReason, headLimit);

      if (mode === "content") {
        const limited = applyHeadLimit(lines, headLimit, params.offset);
        const finalLines = limited.items.map((line) => relativizeContentLine(executionCwd, line));
        return {
          mode,
          numFiles: 0,
          filenames: [],
          content: finalLines.join("\n"),
          numLines: finalLines.length,
          ...(capLimit !== undefined && { appliedLimit: capLimit }),
          ...(limited.appliedLimit !== undefined && { appliedLimit: limited.appliedLimit }),
          ...(limited.appliedOffset !== undefined && { appliedOffset: limited.appliedOffset }),
          ...(truncated && { truncated: true }),
          ...(truncatedReason !== undefined && { truncatedReason }),
        };
      }

      if (mode === "count") {
        const limited = applyHeadLimit(lines, headLimit, params.offset);
        const countLines = limited.items.map((line) => {
          const colonIndex = line.lastIndexOf(":");
          if (colonIndex <= 0) {
            return line;
          }
          const filePath = line.slice(0, colonIndex);
          const count = line.slice(colonIndex);
          return `${toRelative(executionCwd, filePath)}${count}`;
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
          ...(capLimit !== undefined && { appliedLimit: capLimit }),
          ...(limited.appliedLimit !== undefined && { appliedLimit: limited.appliedLimit }),
          ...(limited.appliedOffset !== undefined && { appliedOffset: limited.appliedOffset }),
          ...(truncated && { truncated: true }),
          ...(truncatedReason !== undefined && { truncatedReason }),
        };
      }

      const relativeMatches = lines.map((line) => toRelative(executionCwd, line));
      const sortedMatches = await sortFilesByModifiedTime(executionCwd, relativeMatches);
      const limited = applyHeadLimit(sortedMatches, headLimit, params.offset);
      return {
        mode,
        numFiles: limited.items.length,
        filenames: limited.items,
        ...(capLimit !== undefined && { appliedLimit: capLimit }),
        ...(limited.appliedLimit !== undefined && { appliedLimit: limited.appliedLimit }),
        ...(limited.appliedOffset !== undefined && { appliedOffset: limited.appliedOffset }),
        ...(truncated && { truncated: true }),
        ...(truncatedReason !== undefined && { truncatedReason }),
      };
    },

    formatResult(output) {
      if (output.mode === "content") {
        if ((output.numLines ?? 0) === 0) {
          return "No matches found";
        }
        const resultContent = output.content || "No matches found";
        const limitInfo = formatTruncationInfo(output);
        return limitInfo
          ? `${resultContent}\n\n[Showing results with pagination = ${limitInfo}]`
          : resultContent;
      }

      if (output.mode === "count") {
        if (output.numFiles === 0 || !output.content) {
          return "No matches found";
        }
        const rawContent = output.content || "No matches found";
        const matches = output.numMatches ?? 0;
        const files = output.numFiles ?? 0;
        const limitInfo = formatTruncationInfo(output);
        const scope = limitInfo ? "shown" : "total";
        const summary = `Found ${matches} ${scope} ${matches === 1 ? "occurrence" : "occurrences"} across ${files} ${files === 1 ? "file" : "files"}.`;
        return limitInfo ? `${rawContent}\n\n${summary}\n[Showing results with pagination = ${limitInfo}]` : `${rawContent}\n\n${summary}`;
      }

      if (output.numFiles === 0) {
        return "No files found";
      }

      const limitInfo = formatTruncationInfo(output);
      const result = `Found ${output.numFiles} ${output.numFiles === 1 ? "file" : "files"}\n${output.filenames.join("\n")}`;
      return limitInfo ? `${result}\n\n[Showing results with pagination = ${limitInfo}]` : result;
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
        ...(output.appliedLimit !== undefined && { appliedLimit: output.appliedLimit }),
        ...(output.appliedOffset !== undefined && { appliedOffset: output.appliedOffset }),
        ...(output.truncated !== undefined && { truncated: output.truncated }),
        ...(output.truncatedReason !== undefined && { truncatedReason: output.truncatedReason }),
      };
    },
  });
}
