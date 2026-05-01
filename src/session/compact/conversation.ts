import type { AgentMessage } from "../../agent/types.js";
import { TokenEstimator } from "../token-estimator.js";
import { createPostCompactFileAttachments } from "./attachments.js";
import {
  buildPostCompactMessages,
  createCompactBoundaryMessage,
  createCompactSummaryMessage,
  getMessagesAfterCompactBoundary,
} from "./messages.js";
import { formatCompactSummary, getCompactPrompt } from "./prompt.js";
import { microcompactMessages } from "./microcompact.js";
import type { FileStateCache } from "../../agent/file-state.js";
import type { CompactionResult } from "./types.js";

export interface CompactSummaryRunnerInput {
  prompt: string;
  messages: AgentMessage[];
}

export type CompactSummaryRunner = (
  input: CompactSummaryRunnerInput,
) => Promise<string>;

export interface CompactConversationOptions {
  messages: AgentMessage[];
  summaryRunner: CompactSummaryRunner;
  instructions?: string;
  attachments?: AgentMessage[];
  messagesToKeep?: AgentMessage[];
  keepRecentToolResults?: number;
  maxPromptTooLongRetries?: number;
  fileStateCache?: FileStateCache;
  cwd?: string;
}

export function isPromptTooLongError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /prompt.*too long|context length|maximum context|too many tokens/i.test(message);
}

function truncateForRetry(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 1) {
    return messages;
  }
  return messages.slice(Math.ceil(messages.length / 2));
}

async function runSummaryWithRetry(
  runner: CompactSummaryRunner,
  prompt: string,
  messages: AgentMessage[],
  maxRetries: number,
): Promise<{ rawSummary: string; summaryInputMessages: AgentMessage[] }> {
  let attempt = 0;
  let currentMessages = messages;

  while (true) {
    try {
      return {
        rawSummary: await runner({ prompt, messages: currentMessages }),
        summaryInputMessages: currentMessages,
      };
    } catch (error) {
      if (!isPromptTooLongError(error) || attempt >= maxRetries) {
        throw error;
      }
      attempt++;
      currentMessages = truncateForRetry(currentMessages);
    }
  }
}

export async function compactConversation(
  options: CompactConversationOptions,
): Promise<CompactionResult> {
  const estimator = new TokenEstimator();
  const activeMessages = getMessagesAfterCompactBoundary(options.messages);
  const preCompactTokens = estimator.estimate(activeMessages);
  const microcompact = microcompactMessages(activeMessages, {
    keepRecent: options.keepRecentToolResults,
  });
  const prompt = getCompactPrompt({ instructions: options.instructions });
  const { rawSummary } = await runSummaryWithRetry(
    options.summaryRunner,
    prompt,
    microcompact.messages,
    options.maxPromptTooLongRetries ?? 1,
  );

  const summaryText = formatCompactSummary(rawSummary);
  const boundaryMessage = createCompactBoundaryMessage({
    trigger: "manual",
    preTokens: preCompactTokens,
    tokensSavedByMicrocompact: microcompact.tokensSaved,
    clearedToolCallIds: microcompact.clearedToolCallIds,
  });
  const summaryMessage = createCompactSummaryMessage(summaryText);
  const fileAttachments = options.fileStateCache && options.cwd
    ? await createPostCompactFileAttachments(options.fileStateCache, { cwd: options.cwd })
    : [];
  const attachments = [
    ...(options.attachments ?? []),
    ...fileAttachments,
  ];
  const messagesToKeep = options.messagesToKeep ?? [];
  const postCompactMessages = buildPostCompactMessages({
    boundaryMessage,
    summaryMessage,
    messagesToKeep,
    attachments,
  });
  const postCompactTokens = estimator.estimate(postCompactMessages);

  return {
    boundaryMessage,
    summaryMessage,
    messagesToKeep,
    attachments,
    postCompactMessages,
    displayText: `Compacted conversation: ${preCompactTokens} -> ${postCompactTokens} tokens.`,
    metrics: {
      preCompactTokens,
      postCompactTokens,
      microcompactTokensSaved: microcompact.tokensSaved,
      clearedToolCallIds: microcompact.clearedToolCallIds,
    },
  };
}
