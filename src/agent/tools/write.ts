// src/agent/tools/write.ts
import { Type, type Static } from "@sinclair/typebox";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const writeSchema = Type.Object({
  file_path: Type.String({ description: "The absolute path to the file to write (must be absolute, not relative)" }),
  content: Type.String({ description: "The content to write to the file" }),
});

const writeOutputSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  filePath: Type.String(),
  content: Type.String(),
  originalFile: Type.Union([Type.String(), Type.Null()]),
});

type WriteInput = Static<typeof writeSchema>;
type WriteOutput = Static<typeof writeOutputSchema>;

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema, WriteOutput> {
  return defineAgentTool({
    name: "Write",
    label: "Write",
    description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`,
    parameters: writeSchema,
    outputSchema: writeOutputSchema,
    isDestructive: true,

    async execute(_toolCallId, params, _context) {
      const fullPath = resolve(cwd, params.file_path);

      // 读取旧内容（如果存在）
      let originalFile: string | null = null;
      try {
        originalFile = await readFile(fullPath, "utf-8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }

      // 创建父目录并写入
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, params.content, "utf-8");

      return {
        type: originalFile === null ? "create" : "update",
        filePath: fullPath,
        content: params.content,
        originalFile,
      };
    },

    formatResult(output, _toolCallId) {
      if (output.type === "create") {
        return [{
          type: "text" as const,
          text: `File created successfully at: ${output.filePath}`,
        }];
      }
      return [{
        type: "text" as const,
        text: `The file ${output.filePath} has been updated successfully.`,
      }];
    },
  });
}
