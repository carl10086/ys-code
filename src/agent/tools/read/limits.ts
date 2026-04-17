/**
 * Read tool output limits
 */
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
