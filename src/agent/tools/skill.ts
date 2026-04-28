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
  content: Type.Array(Type.Any()),
  details: Type.Object({
    success: Type.Boolean(),
    skillName: Type.String(),
  }),
  newMessages: Type.Optional(Type.Array(Type.Any())),
  contextModifier: Type.Optional(Type.Any()),
  modelOverride: Type.Optional(Type.String()),
});

type SkillOutput = Static<typeof SkillOutputSchema>;

/**
 * 创建 SkillTool
 * @param getCommands - 获取命令列表的函数
 */
export function createSkillTool(getCommands: () => Promise<Command[]>): AgentTool<typeof SkillInputSchema, SkillOutput> {
  return defineAgentTool({
    name: "Skill",
    label: "Skill",
    description: `Execute a skill by name.

The first user message includes a skill listing that describes all available skills and when to use them. Use that listing to choose the right skill for the task.

Call this tool with the exact skill name from the listing.`,
    parameters: SkillInputSchema,
    outputSchema: SkillOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    async validateInput(params, _context) {
      const commands = await getCommands();
      const command = commands.find(cmd => cmd.name === params.skill && cmd.type === 'prompt') as PromptCommand | undefined;

      if (!command) {
        return { ok: false, message: `Skill "${params.skill}" not found.` };
      }

      if (command.userInvocable === false) {
        return { ok: false, message: `Skill "${params.skill}" is not available for invocation.` };
      }

      return { ok: true };
    },

    async execute(_toolCallId, params, _context): Promise<{ content: unknown[]; details: { success: boolean; skillName: string }; newMessages?: AgentMessage[]; contextModifier?: (messages: AgentMessage[]) => AgentMessage[]; modelOverride?: string }> {
      const commands = await getCommands();
      const command = commands.find(cmd => cmd.name === params.skill && cmd.type === 'prompt') as PromptCommand | undefined;

      // contextModifier 占位实现（后续可限制 allowedTools）
      const modifier = (messages: AgentMessage[]): AgentMessage[] => {
        return messages;
      };

      // 防御性检查：validateInput 已通过，但框架不保证一定调用
      if (!command) {
        return {
          content: [{ type: "text", text: `Skill "${params.skill}" not found` }],
          details: { success: false, skillName: params.skill },
          contextModifier: modifier,
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
        content: [],
        details: { success: true, skillName: params.skill },
        newMessages: [metaUserMessage as AgentMessage],
        contextModifier: modifier,
        modelOverride: command.model,
      };
    },

    formatResult(output) {
      return [{ type: "text", text: `Skill ${output.details.skillName} executed` }];
    },
  });
}