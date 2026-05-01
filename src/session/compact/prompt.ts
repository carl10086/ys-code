export const NO_TOOLS_PREAMBLE =
  "You are summarizing a conversation. Do not use tools.";

export const NO_TOOLS_TRAILER =
  "Return only the final compact summary. Do not call any tools.";

export const COMPACT_SUMMARY_SECTIONS = [
  "1. Primary Request and Intent:",
  "2. Key Technical Concepts:",
  "3. Files and Code Sections:",
  "4. Errors and fixes:",
  "5. Problem Solving:",
  "6. All user messages:",
  "7. Pending Tasks:",
  "8. Current Work:",
  "9. Optional Next Step:",
] as const;

const BASE_COMPACT_PROMPT = [
  "Your task is to create a detailed summary of the conversation so far.",
  "This summary will be used to continue the same coding session after older context is removed.",
  "",
  "Think through the conversation in <analysis> tags, then produce the final answer in <summary> tags.",
  "The final summary must preserve specific implementation details, user preferences, file paths, decisions, errors, fixes, and the next step.",
  "",
  "Use exactly these sections:",
  ...COMPACT_SUMMARY_SECTIONS,
].join("\n");

export interface GetCompactPromptOptions {
  instructions?: string;
}

export function getCompactPrompt(options: GetCompactPromptOptions = {}): string {
  const parts = [
    NO_TOOLS_PREAMBLE,
    "",
    BASE_COMPACT_PROMPT,
  ];

  if (options.instructions?.trim()) {
    parts.push(
      "",
      "Additional Instructions:",
      options.instructions.trim(),
    );
  }

  parts.push("", NO_TOOLS_TRAILER);
  return parts.join("\n");
}

export function formatCompactSummary(raw: string): string {
  const withoutAnalysis = raw
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .trim();
  const summaryMatch = withoutAnalysis.match(/<summary>([\s\S]*?)<\/summary>/i);
  const summary = (summaryMatch ? summaryMatch[1] : withoutAnalysis)
    .trim()
    .replace(/^Summary:\s*/i, "");

  return `Summary:\n${summary}`;
}
