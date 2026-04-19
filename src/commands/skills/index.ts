// src/commands/skills/index.ts
import type { Command } from "../types.js";
import { loadSkillsFromSkillsDir } from "../../skills/loadSkillsDir.js";

const skills = {
  type: "local",
  name: "skills",
  description: "列出所有可用的 skill",
  aliases: ["list-skills"],
  load: async () => {
    const { call } = await import("./skills.js");
    return { call };
  },
} satisfies Command;

export default skills;
