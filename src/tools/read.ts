// src/tools/read.ts
import { Type, type Static } from "@sinclair/typebox";
import { readFile } from "fs/promises";
import { resolve } from "path";
import type { AgentTool } from "../agent/index.js";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

type ReadInput = Static<typeof readSchema>;

export function createReadTool(cwd: string): AgentTool<typeof readSchema> {
  return {
    name: "read",
    label: "Read",
    description: "Read the contents of a file.",
    parameters: readSchema,
    async execute(toolCallId, params) {
      const absolutePath = resolve(cwd, params.path);
      const buffer = await readFile(absolutePath);
      let text = buffer.toString("utf-8");

      if (params.offset !== undefined || params.limit !== undefined) {
        const lines = text.split("\n");
        const start = Math.max(0, (params.offset ?? 1) - 1);
        const end = params.limit !== undefined ? start + params.limit : lines.length;
        text = lines.slice(start, end).join("\n");
      }

      return {
        content: [{ type: "text", text }],
        details: { path: absolutePath },
      };
    },
  };
}
