import * as fs from "node:fs";
import * as path from "node:path";
import type { FileAttachment, DirectoryAttachment } from "./types.js";

/**
 * 从文本中提取 @ 提及的文件路径
 *
 * 支持格式：
 * - 普通路径: @file.ts, @src/utils/logger.ts
 * - 带引号路径（含空格）: @"my file.ts"
 *
 * 排除：
 * - email 地址: user@example.com
 * - 行号范围（第一阶段不支持）
 */
export function extractAtMentionedFiles(text: string): string[] {
  const results: string[] = [];

  // 匹配带引号的路径: @"..."
  const quotedPattern = /@"([^"]+)"/g;

  // 匹配普通路径: @path（排除 @" 开头的引号路径，避免重复匹配）
  // 路径必须以 @ 开头，后跟有效的路径字符
  // 排除 email 格式（前面是 ASCII 字母/数字/下划线/点/横线）
  // 使用 Unicode 属性匹配支持中文文件名
  // 路径需要包含文件扩展名（点号+字母数字），扩展名后停止匹配
  const unquotedPattern = /(?<![a-zA-Z0-9._-])@((?:\.{1,2}\/|[\p{L}\p{N}_\-~]*\/)*[\p{L}\p{N}_\-~]+\.[a-zA-Z0-9]+)/gu;

  // 先提取普通路径（保持文本中的出现顺序）
  let match: RegExpExecArray | null;
  while ((match = unquotedPattern.exec(text)) !== null) {
    const path = match[1];
    // 额外过滤：排除纯数字
    if (/^[0-9]+$/.test(path)) {
      continue;
    }
    results.push(path);
  }

  // 再提取带引号的路径
  while ((match = quotedPattern.exec(text)) !== null) {
    results.push(match[1]);
  }

  return results;
}

/** 大文件阈值：200KB */
const LARGE_FILE_SIZE = 200 * 1024;

/** 大文件截断行数 */
const LARGE_FILE_MAX_LINES = 1000;

/**
 * 读取 @... 提到的文件或目录，生成对应的 Attachment
 * @param filePath 文件路径（支持绝对路径和相对路径）
 * @param cwd 当前工作目录（用于解析相对路径）
 * @returns FileAttachment、DirectoryAttachment 或 null（文件不存在/不可读）
 */
export async function readAtMentionedFile(
  filePath: string,
  cwd: string,
): Promise<FileAttachment | DirectoryAttachment | null> {
  // 解析为绝对路径
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    return null;
  }

  const timestamp = Date.now();
  const displayPath = path.relative(cwd, absolutePath) || ".";

  if (stats.isDirectory()) {
    const entries = fs.readdirSync(absolutePath);
    return {
      type: "directory",
      path: absolutePath,
      content: entries.join("\n"),
      displayPath,
      timestamp,
    };
  }

  // 文件读取
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }

  let truncated: boolean | undefined;

  // 大文件截断：超过 200KB 或超过 1000 行时截断前 1000 行
  if (stats.size > LARGE_FILE_SIZE) {
    const lines = content.split("\n");
    if (lines.length > LARGE_FILE_MAX_LINES) {
      content = lines.slice(0, LARGE_FILE_MAX_LINES).join("\n");
      truncated = true;
    }
  }

  return {
    type: "file",
    filePath: absolutePath,
    content,
    displayPath,
    truncated,
    timestamp,
  };
}
