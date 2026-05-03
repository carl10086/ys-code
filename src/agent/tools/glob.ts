// src/agent/tools/glob.ts
import { Type, type Static } from "@sinclair/typebox";
import { realpath, stat } from "fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool, ToolUseContext } from "../types.js";

const globSchema = Type.Object({
  pattern: Type.String({ maxLength: 1000, description: "The glob pattern to match files against" }),
  path: Type.Optional(Type.String({
    maxLength: 1000,
    description: "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided.",
  })),
});

const globOutputSchema = Type.Object({
  durationMs: Type.Number({ description: "Time taken to execute the search in milliseconds" }),
  numFiles: Type.Number({ description: "Total number of files found" }),
  filenames: Type.Array(Type.String(), { description: "Array of file paths that match the pattern" }),
  truncated: Type.Boolean({ description: "Whether results were truncated (limited to 100 files)" }),
});

type GlobInput = Static<typeof globSchema>;
type GlobOutput = Static<typeof globOutputSchema>;

const MAX_RESULTS = 100;
const MAX_INPUT_LENGTH = 1000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Glob search aborted");
  }
}

function validateMaxLength(value: string | undefined, name: string): string | null {
  if (value !== undefined && value.length > MAX_INPUT_LENGTH) {
    return `${name} must be at most ${MAX_INPUT_LENGTH} characters`;
  }
  return null;
}

function isInsideDirectory(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function extractGlobBaseDirectory(pattern: string): { baseDir: string; relativePattern: string } {
  const match = pattern.match(/[*?[{]/);
  if (!match || match.index === undefined) {
    return { baseDir: dirname(pattern), relativePattern: basename(pattern) };
  }

  const staticPrefix = pattern.slice(0, match.index);
  const lastSeparatorIndex = staticPrefix.lastIndexOf("/");
  if (lastSeparatorIndex === -1) {
    return { baseDir: "", relativePattern: pattern };
  }

  const baseDir = lastSeparatorIndex === 0 ? "/" : staticPrefix.slice(0, lastSeparatorIndex);
  const relativePattern = pattern.slice(lastSeparatorIndex + 1);
  return { baseDir, relativePattern };
}

async function resolveSearchInput(params: GlobInput, cwd: string): Promise<
  | { ok: true; searchDir: string; searchPattern: string; outputCwd: string }
  | { ok: false; message: string; errorCode?: number }
> {
  const realCwd = await realpath(cwd);
  const searchRoot = params.path ? resolve(cwd, params.path) : cwd;
  let realSearchRoot = realCwd;

  if (params.path) {
    const stats = await stat(searchRoot);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        message: `Path is not a directory: ${params.path}`,
        errorCode: 2,
      };
    }

    realSearchRoot = await realpath(searchRoot);
    if (!isInsideDirectory(realCwd, realSearchRoot)) {
      return {
        ok: false,
        message: `Path is outside the workspace: ${params.path}`,
        errorCode: 1,
      };
    }
  }

  if (!isAbsolute(params.pattern)) {
    return { ok: true, searchDir: realSearchRoot, searchPattern: params.pattern, outputCwd: realCwd };
  }

  const { baseDir, relativePattern } = extractGlobBaseDirectory(params.pattern);
  const absoluteBaseDir = resolve(baseDir);
  let baseStats;
  try {
    baseStats = await stat(absoluteBaseDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        message: `Directory does not exist: ${baseDir}`,
        errorCode: 1,
      };
    }
    throw error;
  }

  if (!baseStats.isDirectory()) {
    return {
      ok: false,
      message: `Path is not a directory: ${baseDir}`,
      errorCode: 2,
    };
  }

  const realPatternBase = await realpath(absoluteBaseDir);
  if (!isInsideDirectory(realCwd, realPatternBase)) {
    return {
      ok: false,
      message: `Pattern is outside the workspace: ${params.pattern}`,
      errorCode: 1,
    };
  }
  if (!isInsideDirectory(realSearchRoot, realPatternBase)) {
    return {
      ok: false,
      message: `Pattern is outside the search path: ${params.pattern}`,
      errorCode: 1,
    };
  }

  return { ok: true, searchDir: realPatternBase, searchPattern: relativePattern, outputCwd: realCwd };
}

async function readLimitedLines(
  stream: ReadableStream<Uint8Array>,
  proc: ReturnType<typeof Bun.spawn>,
  outputCwd: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ filenames: string[]; truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const filenames: string[] = [];
  let pending = "";
  let bytesRead = 0;

  const pushLine = (line: string): boolean => {
    if (line.trim()) {
      if (filenames.length >= MAX_RESULTS) {
        proc.kill();
        return true;
      }
      filenames.push(relative(outputCwd, resolve(cwd, line)));
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
    if (bytesRead > MAX_OUTPUT_BYTES) {
      proc.kill();
      await reader.cancel();
      return { filenames, truncated: true };
    }

    pending += decoder.decode(value, { stream: true });
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      if (pushLine(line)) {
        await reader.cancel();
        return { filenames, truncated: true };
      }
      newlineIndex = pending.indexOf("\n");
    }
  }

  pending += decoder.decode();
  if (pending && pushLine(pending)) {
    return { filenames, truncated: true };
  }

  return { filenames, truncated: false };
}

async function readLimitedText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (bytesRead + value.byteLength > MAX_STDERR_BYTES) {
      const remaining = Math.max(0, MAX_STDERR_BYTES - bytesRead);
      if (remaining > 0) {
        chunks.push(decoder.decode(value.slice(0, remaining), { stream: true }));
      }
      await reader.cancel();
      chunks.push(`\n[stderr truncated after ${MAX_STDERR_BYTES} bytes]`);
      return chunks.join("");
    }
    bytesRead += value.byteLength;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

async function runRipgrep(
  pattern: string,
  cwd: string,
  outputCwd: string,
  signal?: AbortSignal,
): Promise<{ filenames: string[]; truncated: boolean }> {
  throwIfAborted(signal);
  const args = [
    "--files",
    "--glob", pattern,
    "--sort=modified",
    "--no-ignore",
    "--hidden",
  ];

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
  const timeoutMs = Number.parseInt(process.env.YS_GLOB_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);
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
    const { filenames, truncated } = await readLimitedLines(proc.stdout, proc, outputCwd, cwd, signal);
    const exitCode = await proc.exited;
    const stderr = await stderrPromise;

    if (aborted || signal?.aborted) {
      throw new Error("Glob search aborted");
    }
    if (timedOut) {
      return { filenames, truncated: true };
    }
    if (truncated) {
      return { filenames, truncated };
    }
    if (exitCode !== 0) {
      if (exitCode === 1 && !stderr.trim()) {
        return { filenames: [], truncated: false };
      }
      throw new Error(`ripgrep failed: ${stderr || `exit code ${exitCode}`}`);
    }

    return { filenames, truncated: false };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

export function createGlobTool(cwd: string): AgentTool<typeof globSchema, GlobOutput> {
  return defineAgentTool({
    name: "Glob",
    label: "Glob",
    description: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`,
    parameters: globSchema,
    outputSchema: globOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    validateInput: async (params: GlobInput) => {
      for (const [name, value] of [
        ["pattern", params.pattern],
        ["path", params.path],
      ] as const) {
        const message = validateMaxLength(value, name);
        if (message) {
          return { ok: false, message, errorCode: 1 };
        }
      }

      if (params.path) {
        if (params.path === "undefined" || params.path === "null") {
          return {
            ok: false,
            message: "Omit path to use the current working directory instead of passing a string placeholder.",
            errorCode: 1,
          };
        }

        const fullPath = resolve(cwd, params.path);
        try {
          await stat(fullPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              ok: false,
              message: `Directory does not exist: ${params.path}`,
              errorCode: 1,
            };
          }
          throw e;
        }
      }

      const resolved = await resolveSearchInput(params, cwd);
      if (!resolved.ok) {
        return { ok: false, message: resolved.message, errorCode: resolved.errorCode };
      }
      return { ok: true };
    },

    async execute(_toolCallId, params, context: ToolUseContext) {
      const resolved = await resolveSearchInput(params, cwd);
      if (!resolved.ok) {
        throw new Error(resolved.message);
      }
      const start = Date.now();

      const { filenames, truncated } = await runRipgrep(
        resolved.searchPattern,
        resolved.searchDir,
        resolved.outputCwd,
        context.abortSignal,
      );

      return {
        durationMs: Date.now() - start,
        numFiles: filenames.length,
        filenames,
        truncated,
      };
    },

    formatResult(output, _toolCallId) {
      if (output.filenames.length === 0) {
        return [{
          type: "text" as const,
          text: "No files found",
        }];
      }

      const lines = [...output.filenames];
      if (output.truncated) {
        lines.push("(Results are truncated. Consider using a more specific path or pattern.)");
      }

      return [{
        type: "text" as const,
        text: lines.join("\n"),
      }];
    },
  });
}
