// src/tools/skillTool.ts
import { Type, type Static } from "@sinclair/typebox";
import { defineAgentTool } from "../agent/define-agent-tool.js";
import type { AgentTool } from "../agent/types.js";
import type { Command, SkillContentBlock } from "../commands/types.js";
import { getCommands } from "../commands/index.js";

const SkillInputSchema = Type.Object({
  skill: Type.String({ description: "Skill name to execute" }),
  args: Type.Optional(Type.String({ description: "Arguments to pass to the skill" })),
});

const SkillOutputSchema = Type.Object({
  content: Type.String(),
  skillName: Type.String(),
});

type SkillInput = Static<typeof SkillInputSchema>;
type SkillOutput = Static<typeof SkillOutputSchema>;

/**
 * 创建 SkillTool
 * @param getCommands - 获取命令列表的函数
 */
export function createSkillTool(getCommands: () => Promise<Command[]>): AgentTool<typeof SkillInputSchema, SkillOutput> {
  return defineAgentTool({
    name: "Skill",
    label: "Skill",
    description: "Execute a skill by name. Skills are specialized prompts that help with specific tasks like brainstorming, code review, or planning.",
    parameters: SkillInputSchema,
    outputSchema: SkillOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    async execute(toolCallId, params, _context) {
      const commands = await getCommands();
      const command = commands.find(cmd => cmd.name === params.skill && cmd.type === 'prompt');

      if (!command) {
        return {
          content: `Skill '${params.skill}' not found. Available skills: ${commands.filter(c => c.type === 'prompt').map(c => c.name).join(', ')}`,
          skillName: params.skill,
        };
      }

      if (command.type !== 'prompt') {
        return {
          content: `'${params.skill}' is not a skill.`,
          skillName: params.skill,
        };
      }

      // 执行 skill 获取内容
      const contentBlocks = await command.getPromptForCommand(params.args ?? '');

      // 转换为文本
      const textContent = contentBlocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');

      return {
        content: textContent,
        skillName: params.skill,
      };
    },

    formatResult(output) {
      return [{ type: "text", text: output.content }];
    },
  });
}
