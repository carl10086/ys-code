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

/**
 * FileReadTool 的输出格式
 * 对应 cc 的 FileReadToolOutput 类型
 */
export interface FileReadToolOutput {
  /** 内容类型 */
  type: "text" | "image" | "pdf" | "notebook" | "parts" | "file_unchanged";
  /** 文本文件内容（仅 type=text 时存在） */
  file?: {
    /** 文件绝对路径 */
    filePath: string;
    /** 文件文本内容 */
    content: string;
    /** 当前片段行数 */
    numLines: number;
    /** 起始行号 */
    startLine: number;
    /** 文件总行数 */
    totalLines: number;
  };
  /** 图片内容（仅 type=image 时存在） */
  base64ImageData?: string;
  /** PDF 页数（仅 type=pdf 时存在） */
  pageCount?: number;
};

/** 文件附件 */
export interface FileAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "file";
  /** 文件绝对路径 */
  filePath: string;
  /** 文件内容（FileReadToolOutput 格式） */
  content: FileReadToolOutput;
  /** 相对路径，用于显示 */
  displayPath: string;
  /** 是否因大小限制被截断 */
  truncated?: boolean;
}

/** 目录附件 */
export interface DirectoryAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "directory";
  /** 目录绝对路径 */
  path: string;
  /** 目录内容，ls 结果 */
  content: string;
  /** 相对路径，用于显示 */
  displayPath: string;
}

/** 附件联合体 —— 包含 relevant_memories、file、directory */
export type Attachment = RelevantMemoriesAttachment | FileAttachment | DirectoryAttachment;

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
