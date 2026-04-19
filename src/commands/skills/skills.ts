// src/commands/skills/skills.ts
import type { CommandContext, CommandResult } from "../types.js";
import { loadSkillsFromSkillsDir } from "../../skills/loadSkillsDir.js";

/**
 * 列出所有可用的 skill
 */
export async function call(
  _args: string,
  _context: CommandContext,
): Promise<CommandResult> {
  const skills = await loadSkillsFromSkillsDir(".claude/skills", "projectSettings");

  if (skills.length === 0) {
    return { type: "text", value: "No skills found." };
  }

  const list = skills
    .map((s) => `  /${s.name} - ${s.description}`)
    .join("\n");

  return { type: "text", value: `Available skills:\n${list}` };
}
