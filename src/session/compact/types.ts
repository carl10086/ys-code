import type { AgentMessage } from "../../agent/types.js";

export type CompactTriggerReason = "manual" | "auto";

export interface CompactMetadata {
  trigger: CompactTriggerReason;
  preTokens: number;
  postTokens?: number;
  tokensSavedByMicrocompact?: number;
  clearedToolCallIds?: string[];
}

export interface CompactBoundaryMessage {
  role: "compact_boundary";
  uuid: string;
  timestamp: number;
  parentUuid?: string | null;
  compactMetadata: CompactMetadata;
}

export interface CompactMessageBuildInput {
  boundaryMessage: AgentMessage;
  summaryMessage: AgentMessage;
  messagesToKeep: AgentMessage[];
  attachments: AgentMessage[];
}

export interface CompactionResult extends CompactMessageBuildInput {
  postCompactMessages: AgentMessage[];
  displayText: string;
  metrics: {
    preCompactTokens: number;
    postCompactTokens?: number;
    microcompactTokensSaved: number;
    clearedToolCallIds: string[];
  };
}

declare module "../../agent/types.js" {
  interface CustomAgentMessages {
    compactBoundary: CompactBoundaryMessage;
  }
}
