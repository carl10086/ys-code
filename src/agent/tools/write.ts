// src/agent/tools/write.ts
import { Type, type Static } from "@sinclair/typebox";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

const writeOutputSchema = Type.Object({
  path: Type.String(),
  bytes: Type.Number(),
});

type WriteInput = Static<typeof writeSchema>;
type WriteOutput = Static<typeof writeOutputSchema>;

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema, WriteOutput> {
  return defineAgentTool({
    name: "write",
    label: "Write",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: writeSchema,
    outputSchema: writeOutputSchema,
    isDestructive: true,
    async execute(toolCallId, params, context) {
      const absolutePath = resolve(cwd, params.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, params.content, "utf-8");
      const bytes = Buffer.byteLength(params.content, "utf-8");
      return { path: absolutePath, bytes };
    },
    formatResult(output) {
      return [{ type: "text", text: `Wrote ${output.bytes} bytes to ${output.path}` }];
    },
  });
}
