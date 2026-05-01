import type { AgentMessage } from "../../agent/types.js";

export const MICROCOMPACT_CLEARED_MESSAGE = "[Old tool result content cleared]";

export const COMPACTABLE_TOOLS = [
  "Read",
  "Bash",
  "WebFetch",
] as const;

export interface MicrocompactOptions {
  keepRecent?: number;
  compactableTools?: readonly string[];
}

export interface MicrocompactResult {
  messages: AgentMessage[];
  tokensSaved: number;
  clearedToolCallIds: string[];
  keptToolCallIds: string[];
}

function isToolResultMessage(message: AgentMessage): message is Extract<AgentMessage, { role: "toolResult" }> {
  return message.role === "toolResult";
}

function estimateContentTokens(content: unknown): number {
  const text = JSON.stringify(content) ?? "";
  return Math.ceil(text.length / 4);
}

export function microcompactMessages(
  messages: AgentMessage[],
  options: MicrocompactOptions = {},
): MicrocompactResult {
  const keepRecent = Math.max(0, options.keepRecent ?? 3);
  const compactableTools = new Set(options.compactableTools ?? COMPACTABLE_TOOLS);
  const compactableToolResultIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) =>
      isToolResultMessage(message) && compactableTools.has(message.toolName)
    )
    .map(({ index }) => index);
  const indexesToKeep = new Set(
    keepRecent === 0 ? [] : compactableToolResultIndexes.slice(-keepRecent),
  );

  let tokensSaved = 0;
  const clearedToolCallIds: string[] = [];
  const keptToolCallIds: string[] = [];

  const compacted = messages.map((message, index): AgentMessage => {
    if (!isToolResultMessage(message)) {
      return message;
    }

    if (!compactableTools.has(message.toolName) || indexesToKeep.has(index)) {
      keptToolCallIds.push(message.toolCallId);
      return message;
    }

    const oldTokens = estimateContentTokens(message.content);
    const newContent = [{ type: "text" as const, text: MICROCOMPACT_CLEARED_MESSAGE }];
    const newTokens = estimateContentTokens(newContent);
    tokensSaved += Math.max(0, oldTokens - newTokens);
    clearedToolCallIds.push(message.toolCallId);

    return {
      ...message,
      content: newContent,
    };
  });

  return {
    messages: compacted,
    tokensSaved,
    clearedToolCallIds,
    keptToolCallIds,
  };
}
