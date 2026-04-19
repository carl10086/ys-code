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
