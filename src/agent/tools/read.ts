// src/agent/tools/read.ts
import { Type, type Static } from "@sinclair/typebox";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const readOutputSchema = Type.Object({
  text: Type.String(),
  path: Type.String(),
});

type ReadInput = Static<typeof readSchema>;
type ReadOutput = Static<typeof readOutputSchema>;

export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    name: "read",
    label: "Read",
    description: "Read the contents of a file.",
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(toolCallId, params, context) {
      const absolutePath = resolve(cwd, params.path);
      let text = await readFile(absolutePath, "utf-8");

      if (params.offset !== undefined || params.limit !== undefined) {
        const lines = text.split("\n");
        const start = Math.max(0, (params.offset ?? 1) - 1);
        const end = params.limit !== undefined ? start + params.limit : lines.length;
        text = lines.slice(start, end).join("\n");
      }

      return { text, path: absolutePath };
    },
    formatResult(output) {
      return [{ type: "text", text: output.text }];
    },
  });
}
