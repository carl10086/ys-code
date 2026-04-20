// src/commands/skill-tags.ts

/** XML 标签常量 - 用于 skill 命令的元数据格式 */
export const COMMAND_MESSAGE_TAG = 'command-message';
export const COMMAND_NAME_TAG = 'command-name';
export const COMMAND_ARGS_TAG = 'command-args';

/**
 * XML 特殊字符转义
 * 防止 XML 注入攻击
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成 skill 命令的元数据字符串
 * @param commandName 命令名称（不含 /）
 * @param args 命令参数
 * @returns 格式化的 XML 字符串
 */
export function formatSkillMetadata(commandName: string, args?: string): string {
  return [
    `<${COMMAND_MESSAGE_TAG}>${escapeXml(commandName)}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>/${escapeXml(commandName)}</${COMMAND_NAME_TAG}>`,
    args ? `<${COMMAND_ARGS_TAG}>${escapeXml(args)}</${COMMAND_ARGS_TAG}>` : null,
  ].filter(Boolean).join('\n');
}
