// src/agent/tools/diff-formatter.ts
import { Type } from "@sinclair/typebox";
import { structuredPatch, type StructuredPatchHunk } from "diff";

/** StructuredPatchHunk 的 TypeBox schema，用于 outputSchema 类型安全 */
export const structuredPatchHunkSchema = Type.Object({
  /** 旧文件起始行号 */
  oldStart: Type.Number(),
  /** 旧文件行数 */
  oldLines: Type.Number(),
  /** 新文件起始行号 */
  newStart: Type.Number(),
  /** 新文件行数 */
  newLines: Type.Number(),
  /** 差异行列表（以 +、-、空格开头） */
  lines: Type.Array(Type.String()),
});

const AMPERSAND_TOKEN = "<<:AMPERSAND_TOKEN:>>";
const DOLLAR_TOKEN = "<<:DOLLAR_TOKEN:>>";

function escapeForDiff(s: string): string {
  return s.replaceAll("&", AMPERSAND_TOKEN).replaceAll("$", DOLLAR_TOKEN);
}

function unescapeFromDiff(s: string): string {
  return s.replaceAll(AMPERSAND_TOKEN, "&").replaceAll(DOLLAR_TOKEN, "$");
}

export function generatePatch(
  filePath: string,
  oldContent: string,
  newContent: string,
): StructuredPatchHunk[] {
  const result = structuredPatch(
    filePath,
    filePath,
    escapeForDiff(oldContent),
    escapeForDiff(newContent),
    undefined,
    undefined,
    { context: 3 },
  );

  if (!result || !result.hunks) {
    return [];
  }

  return result.hunks.map((hunk) => ({
    ...hunk,
    lines: hunk.lines.map((line) => unescapeFromDiff(line)),
  }));
}

export function formatPatchToText(
  filePath: string,
  hunks: StructuredPatchHunk[],
): string {
  if (hunks.length === 0) {
    return "";
  }

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  for (const hunk of hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    for (const line of hunk.lines) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/**
 * 将基础消息和 diff patch 组合为 LLM 可见的文本
 * @param filePath 文件路径
 * @param hunks patch hunks
 * @param baseMessage 基础成功消息（不含 diff）
 * @returns 组合后的文本
 */
export function formatResultWithDiff(
  filePath: string,
  hunks: StructuredPatchHunk[],
  baseMessage: string,
): string {
  const diffText = formatPatchToText(filePath, hunks);
  return diffText ? `${baseMessage}\n\n${diffText}` : baseMessage;
}
