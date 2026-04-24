import { stat } from 'fs/promises';

/** 默认文件大小限制：1GB */
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

/**
 * 检查文件大小是否超过限制
 * @param filePath 文件路径
 * @param maxBytes 最大允许字节数，默认 1GB
 * @throws 文件超过限制时抛出 Error
 */
export async function checkFileSize(
  filePath: string,
  maxBytes = MAX_FILE_SIZE_BYTES,
): Promise<void> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return; // 文件不存在，跳过检查
    }
    throw e; // 其他错误（权限、IO 等）抛出让调用方处理
  }
  if (stats.size > maxBytes) {
    throw new Error(
      `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). ` +
        `Maximum allowed: ${(maxBytes / 1024 / 1024).toFixed(0)}MB.`,
    );
  }
}
