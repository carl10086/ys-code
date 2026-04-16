// src/agent/tools/write.ts
import { Type, type Static } from "@sinclair/typebox";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import type { AgentTool } from "../types.js";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

type WriteInput = Static<typeof writeSchema>;

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema, { path: string; bytes: number }> {
  return {
    name: "write",
    label: "Write",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: writeSchema,
    async execute(toolCallId, params) {
      const absolutePath = resolve(cwd, params.path);
      try {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, params.content, "utf-8");
        const bytes = Buffer.byteLength(params.content, "utf-8");

        return {
          content: [{ type: "text", text: `Wrote ${bytes} bytes to ${absolutePath}` }],
          details: { path: absolutePath, bytes },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error writing file: ${message}` }],
          details: { path: absolutePath, bytes: 0 },
        };
      }
    },
  };
}
