// src/session/entry-types.ts

/** 会话条目基接口 */
export interface SessionEntry {
  /** 条目类型 */
  type: string;
  /** 唯一标识符 */
  uuid: string;
  /** 父条目 UUID（链式/DAG 结构） */
  parentUuid: string | null;
  /** 时间戳（毫秒） */
  timestamp: number;
}

/** 文件头条目 */
export interface HeaderEntry extends SessionEntry {
  type: "header";
  /** 数据格式版本号 */
  version: number;
  /** 会话 ID */
  sessionId: string;
  /** 当前工作目录 */
  cwd: string;
}

/** 用户消息条目 */
export interface UserEntry extends SessionEntry {
  type: "user";
  /** 消息内容 */
  content: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  /** 是否为 meta 消息（UI 隐藏，LLM 可见） */
  isMeta?: boolean;
}

/** Assistant 消息条目 */
export interface AssistantEntry extends SessionEntry {
  type: "assistant";
  /** 消息内容 */
  content: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  >;
  /** 使用的模型名称 */
  model: string;
  /** Token 使用量 */
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
  };
  /** 停止原因 */
  stopReason: string;
  /** 错误信息 */
  errorMessage?: string;
}

/** 工具结果条目 */
export interface ToolResultEntry extends SessionEntry {
  type: "toolResult";
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 结果内容 */
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  /** 是否出错 */
  isError: boolean;
  /** 详细结果 */
  details?: unknown;
}

/** Compact 边界条目 */
export interface CompactBoundaryEntry extends SessionEntry {
  type: "compact_boundary";
  /** 摘要内容 */
  summary: string;
  /** 压缩前的 token 数 */
  tokensBefore: number;
  /** 压缩后的 token 数 */
  tokensAfter: number;
}

/** Attachment 条目 */
export interface AttachmentEntry extends SessionEntry {
  /** 条目类型 */
  type: "attachment";
  /** 附件类型 */
  attachmentType: "relevant_memories" | "file" | "directory" | "skill_listing";
  /** 附件内容（序列化后的 JSON） */
  content: string;
}

/** 所有条目的联合类型 */
export type Entry = HeaderEntry | UserEntry | AssistantEntry | ToolResultEntry | CompactBoundaryEntry | AttachmentEntry;
