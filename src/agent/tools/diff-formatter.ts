// src/agent/tools/diff-formatter.ts
import { structuredPatch, type StructuredPatchHunk } from "diff";

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

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

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
