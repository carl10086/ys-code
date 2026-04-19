import type { UserMessage } from "../../core/ai/types.js";

/** 附件基础接口 */
export interface BaseAttachment {
  /** 附件类型 */
  type: string;
  /** 生成时间戳 */
  timestamp: number;
}

/** 相关记忆附件（CLAUDE.md 等上下文） */
export interface RelevantMemoriesAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "relevant_memories";
  /** 上下文项列表 */
  entries: Array<{
    /** 上下文键名，如 "CLAUDE.md" */
    key: string;
    /** 上下文内容 */
    value: string;
  }>;
}

/** 附件联合体 —— 第一阶段只包含 relevant_memories */
export type Attachment = RelevantMemoriesAttachment;

/** 附件消息 */
export interface AttachmentMessage {
  /** 消息角色 */
  role: "attachment";
  /** 附件内容 */
  attachment: Attachment;
  /** 时间戳 */
  timestamp: number;
}

// 通过 declaration merging 扩展 AgentMessage
declare module "../types.js" {
  interface CustomAgentMessages {
    /** 附件消息扩展 */
    attachment: AttachmentMessage;
  }
}
