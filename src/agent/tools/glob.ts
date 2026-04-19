// src/agent/tools/glob.ts
import { Type, type Static } from "@sinclair/typebox";
import { stat } from "fs/promises";
import { relative, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const globSchema = Type.Object({
  pattern: Type.String({ description: "The glob pattern to match files against" }),
  path: Type.Optional(Type.String({
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

async function runRipgrep(pattern: string, cwd: string): Promise<{ filenames: string[]; truncated: boolean }> {
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

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    // rg --files returns exit code 1 when no files found, which is not an error
    if (exitCode === 1 && !stderr.trim()) {
      return { filenames: [], truncated: false };
    }
    throw new Error(`ripgrep failed: ${stderr || `exit code ${exitCode}`}`);
  }

  const lines = stdout.split("\n").filter((line) => line.trim());
  const truncated = lines.length > MAX_RESULTS;
  const filenames = lines.slice(0, MAX_RESULTS).map((p) => relative(cwd, resolve(cwd, p)));

  return { filenames, truncated };
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
      if (params.path) {
        const fullPath = resolve(cwd, params.path);
        try {
          const stats = await stat(fullPath);
          if (!stats.isDirectory()) {
            return {
              ok: false,
              message: `Path is not a directory: ${params.path}`,
              errorCode: 2,
            };
          }
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
      return { ok: true };
    },

    async execute(_toolCallId, params, _context) {
      const searchDir = params.path ? resolve(cwd, params.path) : cwd;
      const start = Date.now();

      const { filenames, truncated } = await runRipgrep(params.pattern, searchDir);

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
