// src/agent/tools/skill.ts
import { Type, type Static } from "@sinclair/typebox";
import type { UserMessage } from "../../core/ai/index.js";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool, AgentMessage } from "../types.js";
import type { Command, PromptCommand } from "../../commands/types.js";

const SkillInputSchema = Type.Object({
  skill: Type.String({ description: "Skill name to execute" }),
  args: Type.Optional(Type.String({ description: "Arguments to pass to the skill" })),
});

const SkillOutputSchema = Type.Object({
  success: Type.Boolean(),
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

    async execute(_toolCallId, params, _context): Promise<SkillOutput & { newMessages?: AgentMessage[] }> {
      const commands = await getCommands();
      const command = commands.find(cmd => cmd.name === params.skill && cmd.type === 'prompt') as PromptCommand | undefined;

      if (!command) {
        // 返回错误结果
        return {
          success: false,
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

      // 创建 meta user 消息（UI 隐藏，LLM 可见）
      const metaUserMessage: UserMessage = {
        role: "user",
        content: textContent,
        timestamp: Date.now(),
        isMeta: true,
      };

      // 返回结果（包含 newMessages 由 tool-execution.ts 注入）
      return {
        success: true,
        skillName: params.skill,
        newMessages: [metaUserMessage as AgentMessage],
      };
    },

    formatResult(output) {
      return [{ type: "text", text: `Skill ${output.skillName} executed` }];
    },
  });
}