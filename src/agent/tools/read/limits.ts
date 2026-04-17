/**
 * Read tool output limits and API constraints
 */

// 图片限制
export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5 MB
export const IMAGE_TARGET_RAW_SIZE = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4; // 3.75 MB
export const IMAGE_MAX_WIDTH = 2000;
export const IMAGE_MAX_HEIGHT = 2000;

// PDF 限制
export const PDF_TARGET_RAW_SIZE = 20 * 1024 * 1024; // 20 MB
export const PDF_MAX_EXTRACT_SIZE = 100 * 1024 * 1024; // 100 MB
export const PDF_MAX_PAGES_PER_READ = 20;
export const PDF_AT_MENTION_INLINE_THRESHOLD = 10;
export const API_PDF_MAX_PAGES = 100;

// 媒体限制
export const API_MAX_MEDIA_PER_REQUEST = 100;

export interface FileReadingLimits {
  /** 输出 token 限制，默认 25000 */
  maxTokens: number;
  /** 文件大小限制，默认 256KB */
  maxSizeBytes: number;
}

/** 默认限制配置 */
export const DEFAULT_LIMITS: FileReadingLimits = {
  maxTokens: 25000,
  maxSizeBytes: 256 * 1024, // 256KB
};

/** Token 超出错误 */
export class MaxFileReadTokenExceededError extends Error {
  constructor(
    public tokenCount: number,
    public maxTokens: number,
  ) {
    super(
      `File content (${tokenCount} tokens) exceeds maximum allowed tokens (${maxTokens}). ` +
        `Use offset and limit parameters to read specific portions of the file, ` +
        `or search for specific content instead of reading the whole file.`,
    );
    this.name = 'MaxFileReadTokenExceededError';
  }
}

/**
 * 粗略估算文本 token 数
 * 简单估算：每 4 个字符约 1 个 token
 */
export function roughTokenCount(content: string): number {
  return Math.ceil(content.length / 4);
}
