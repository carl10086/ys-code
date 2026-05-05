import type { AgentMessage } from "../../agent/types.js";
import type {
  CompactBoundaryMessage,
  CompactMessageBuildInput,
  CompactTriggerReason,
} from "./types.js";
import type { CompactSummaryValidation } from "./prompt.js";

export interface CreateCompactBoundaryMessageOptions {
  trigger: CompactTriggerReason;
  preTokens: number;
  postTokens?: number;
  tokensSavedByMicrocompact?: number;
  clearedToolCallIds?: string[];
  summaryCheck?: CompactSummaryValidation;
  parentUuid?: string | null;
  timestamp?: number;
  uuid?: string;
}

export function createCompactBoundaryMessage(
  options: CreateCompactBoundaryMessageOptions,
): CompactBoundaryMessage {
  const metadata: CompactBoundaryMessage["compactMetadata"] = {
    trigger: options.trigger,
    preTokens: options.preTokens,
  };

  if (options.postTokens !== undefined) {
    metadata.postTokens = options.postTokens;
  }
  if (options.tokensSavedByMicrocompact !== undefined) {
    metadata.tokensSavedByMicrocompact = options.tokensSavedByMicrocompact;
  }
  if (options.clearedToolCallIds !== undefined) {
    metadata.clearedToolCallIds = options.clearedToolCallIds;
  }
  if (options.summaryCheck !== undefined) {
    metadata.summaryCheck = options.summaryCheck;
  }

  return {
    role: "compact_boundary",
    uuid: options.uuid ?? crypto.randomUUID(),
    parentUuid: options.parentUuid ?? null,
    timestamp: options.timestamp ?? Date.now(),
    compactMetadata: metadata,
  };
}

export function createCompactSummaryMessage(
  summary: string,
  timestamp: number = Date.now(),
): AgentMessage {
  return {
    role: "user",
    isMeta: true,
    timestamp,
    content: [{ type: "text", text: summary }],
  };
}

export function isCompactBoundaryMessage(
  message: AgentMessage,
): message is CompactBoundaryMessage {
  return (message as { role?: unknown }).role === "compact_boundary";
}

export function getMessagesAfterCompactBoundary(
  messages: AgentMessage[],
): AgentMessage[] {
  const lastBoundaryIndex = messages.findLastIndex(isCompactBoundaryMessage);
  return lastBoundaryIndex === -1
    ? messages
    : messages.slice(lastBoundaryIndex + 1);
}

export function buildPostCompactMessages(
  input: CompactMessageBuildInput,
): AgentMessage[] {
  return [
    input.boundaryMessage,
    input.summaryMessage,
    ...input.messagesToKeep,
    ...input.attachments,
  ];
}
