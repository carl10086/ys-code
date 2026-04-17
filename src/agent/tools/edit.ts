// src/agent/tools/edit.ts
import { Type, type Static } from "@sinclair/typebox";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const replaceEditSchema = Type.Object({
  oldText: Type.String({ description: "Exact text to replace" }),
  newText: Type.String({ description: "Replacement text" }),
});

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(replaceEditSchema, {
    description: "One or more targeted replacements. oldText must be unique in the file.",
  }),
});

const editOutputSchema = Type.Object({
  path: Type.String(),
  edits: Type.Number(),
});

type EditInput = Static<typeof editSchema>;
type EditOutput = Static<typeof editOutputSchema>;

export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    name: "edit",
    label: "Edit",
    description: "Edit a file by replacing exact text segments.",
    parameters: editSchema,
    outputSchema: editOutputSchema,
    isDestructive: true,
    async execute(toolCallId, params, context) {
      const absolutePath = resolve(cwd, params.path);
      let content = await readFile(absolutePath, "utf-8");

      for (const edit of params.edits) {
        if (!content.includes(edit.oldText)) {
          throw new Error(`oldText not found in file: ${edit.oldText.slice(0, 50)}...`);
        }
        const occurrences = content.split(edit.oldText).length - 1;
        if (occurrences > 1) {
          throw new Error(`oldText is not unique in file (found ${occurrences} occurrences)`);
        }
        content = content.replace(edit.oldText, edit.newText);
      }

      await writeFile(absolutePath, content, "utf-8");

      return { path: absolutePath, edits: params.edits.length };
    },
    formatResult(output) {
      return [{ type: "text", text: `Edited ${output.path} with ${output.edits} replacement(s)` }];
    },
  });
}
