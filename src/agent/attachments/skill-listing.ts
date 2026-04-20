import { join } from "node:path";
import type { PromptCommand } from "../../commands/types.js";
import { getCommands } from "../../commands/index.js";
import type { AgentMessage } from "../types.js";
import type { SkillListingAttachment } from "./types.js";

/**
 * 格式化 skill 列表文本，完全复用 CC 格式
 * 格式："- name: description - whenToUse"
 */
export function formatSkillListing(commands: PromptCommand[]): string {
  return commands
    .filter((cmd) => cmd.type === "prompt")
    .map((cmd) => {
      const desc = cmd.whenToUse
        ? `${cmd.description} - ${cmd.whenToUse}`
        : cmd.description;
      return `- ${cmd.name}: ${desc}`;
    })
    .join("\n");
}

/**
 * 扫描 user message 中的 @... 引用，注入对应的 attachment 消息
 * @param messages 原始 AgentMessage 数组
 * @param cwd 当前工作目录（用于解析相对路径）
 * @returns 注入 attachment 后的新数组
 */
export async function injectSkillListingAttachments(
  messages: AgentMessage[],
  cwd: string,
): Promise<AgentMessage[]> {
  // 找到第一条 user message
  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  if (firstUserIndex === -1) {
    return messages;
  }

  // 获取所有可用 skills
  const commands = await getCommands(join(cwd, ".claude/skills"));
  const promptCommands = commands.filter(
    (cmd): cmd is PromptCommand => cmd.type === "prompt",
  );

  // 获取新增 skills（由 session 的 sentSkillNames 过滤）
  // 注意：此函数只负责格式化，sentSkillNames 的管理由 session 负责
  if (promptCommands.length === 0) {
    return messages;
  }

  // 格式化
  const content = formatSkillListing(promptCommands);
  const attachment: SkillListingAttachment = {
    type: "skill_listing",
    content,
    skillNames: promptCommands.map((s) => s.name),
    timestamp: Date.now(),
  };

  // 插入到第一条 user message 之后
  return [
    ...messages.slice(0, firstUserIndex + 1),
    { role: "attachment", attachment } as AgentMessage,
    ...messages.slice(firstUserIndex + 1),
  ];
}
