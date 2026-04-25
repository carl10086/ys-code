// src/agent/tools/write.ts
import { Type, type Static } from "@sinclair/typebox";
import { mkdir, readFile, stat } from "fs/promises";
import type { Stats } from "fs";
import { dirname, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";
import { checkFileSize, DIRTY_WRITE_MESSAGE, MAX_FILE_SIZE_BYTES } from "./file-guard.js";
import { readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";

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

    async validateInput(params, context) {
      const fullPath = resolve(cwd, params.file_path);

      let exists: boolean;
      let fileStats: Stats | null = null;
      try {
        fileStats = await stat(fullPath);
        exists = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          exists = false;
        } else {
          throw e;
        }
      }

      if (!exists) {
        return { ok: true };
      }

      // 文件大小检查（复用已获取的 stats）
      if (fileStats) {
        await checkFileSize(fullPath, MAX_FILE_SIZE_BYTES, fileStats.size);
      }

      const readCheck = context.fileStateCache.canEdit(fullPath);
      if (!readCheck.ok) {
        return {
          ok: false,
          message: readCheck.reason,
          errorCode: readCheck.errorCode,
        };
      }

      const currentMtime = Math.floor(fileStats!.mtimeMs);
      if (currentMtime > readCheck.record.timestamp) {
        const isFullRead =
          readCheck.record.offset === undefined &&
          readCheck.record.limit === undefined;
        if (!isFullRead) {
          return {
            ok: false,
            message: DIRTY_WRITE_MESSAGE,
            errorCode: 7,
          };
        }
        const content = await readFile(fullPath, 'utf-8').catch(() => null);
        if (content !== readCheck.record.content) {
          return {
            ok: false,
            message: DIRTY_WRITE_MESSAGE,
            errorCode: 7,
          };
        }
      }

      return { ok: true };
    },

    async execute(_toolCallId, params, context) {
      const fullPath = resolve(cwd, params.file_path);

      let originalFile: string | null = null;
      let fileEncoding: { encoding: "utf8" | "utf16le"; lineEndings: "\n" | "\r\n" } = {
        encoding: "utf8",
        lineEndings: "\n",
      };
      try {
        const result = await readFileWithEncoding(fullPath);
        originalFile = result.content;
        fileEncoding = result.encoding;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }

      const record = context.fileStateCache.get(fullPath);
      const fileStats = await stat(fullPath).catch(() => null);
      if (fileStats && record) {
        const currentMtime = Math.floor(fileStats.mtimeMs);
        if (currentMtime > record.timestamp) {
          const isFullRead = record.offset === undefined && record.limit === undefined;
          const contentUnchanged = isFullRead && originalFile === record.content;
          if (!contentUnchanged) {
            throw new Error(DIRTY_WRITE_MESSAGE);
          }
        }
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFileWithEncoding(fullPath, params.content, fileEncoding);

      const newStats = await stat(fullPath);
      context.fileStateCache.recordEdit(fullPath, params.content, Math.floor(newStats.mtimeMs));

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
