// src/commands/parser.ts

/** 解析后的 slash command 结果 */
export interface ParsedSlashCommand {
  /** 命令名称（不含前导 /） */
  commandName: string;
  /** 命令参数 */
  args: string;
}

/**
 * 解析 slash command 输入字符串
 * @param input 用户输入（应以 / 开头）
 * @returns 解析结果，若不是 slash command 则返回 null
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");

  const commandName = spaceIndex === -1
    ? withoutSlash
    : withoutSlash.slice(0, spaceIndex);
  const args = spaceIndex === -1
    ? ""
    : withoutSlash.slice(spaceIndex + 1).trim();

  if (!commandName) {
    return null;
  }

  return { commandName, args };
}
