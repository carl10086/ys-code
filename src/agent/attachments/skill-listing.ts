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
 * 注入 skill listing attachment 到消息数组
 * @param messages 原始 AgentMessage 数组
 * @param cwd 当前工作目录
 * @param sentSkillNames 已发送的 skill 名称集合（用于去重）
 * @returns 注入 attachment 后的新数组
 */
export async function injectSkillListingAttachments(
  messages: AgentMessage[],
  cwd: string,
  sentSkillNames: Set<string>,
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

  // 过滤出新增的 skills（去重）
  const newSkills = promptCommands.filter(
    (cmd) => !sentSkillNames.has(cmd.name),
  );

  if (newSkills.length === 0) {
    return messages;
  }

  // 格式化
  const content = formatSkillListing(newSkills);
  const skillNames = newSkills.map((s) => s.name);
  const attachment: SkillListingAttachment = {
    type: "skill_listing",
    content,
    skillNames,
    timestamp: Date.now(),
  };

  // 更新已发送集合
  for (const name of skillNames) {
    sentSkillNames.add(name);
  }

  // 插入到第一条 user message 之后
  return [
    ...messages.slice(0, firstUserIndex + 1),
    { role: "attachment", attachment } as AgentMessage,
    ...messages.slice(firstUserIndex + 1),
  ];
}
