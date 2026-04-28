/** 附件基础接口 */
export interface BaseAttachment {
  /** 附件类型 */
  type: string;
  /** 生成时间戳 */
  timestamp: number;
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

/** Skill listing attachment - 告诉 LLM 有哪些 skills 可用 */
export interface SkillListingAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "skill_listing";
  /** 格式化后的 skills 列表文本 */
  content: string;
  /** 本次包含的 skill 名称列表（用于去重） */
  skillNames: string[];
}

/** 附件联合体 —— 包含 file、directory、skill_listing */
export type Attachment = FileAttachment | DirectoryAttachment | SkillListingAttachment;

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
