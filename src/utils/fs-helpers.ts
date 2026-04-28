import { realpathSync } from "fs";
import { resolve } from "path";

/** 安全解析路径，返回解析后的路径和是否是符号链接 */
export function safeResolvePath(filePath: string): { resolvedPath: string; isSymlink: boolean } {
  try {
    const absolutePath = resolve(filePath);
    const resolved = realpathSync(absolutePath);
    return { resolvedPath: resolved, isSymlink: resolved !== absolutePath };
  } catch {
    return { resolvedPath: resolve(filePath), isSymlink: false };
  }
}

/** 从错误对象获取 errno code */
export function getErrnoCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}
