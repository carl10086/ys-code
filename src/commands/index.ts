// src/commands/index.ts
import type { Command, CommandContext, CommandResult, LocalJSXCommandOnDone } from "./types.js";
import { getCommandName, isCommandEnabled } from "./types.js";
import type React from "react";

export type { Command, CommandContext, CommandResult } from "./types.js";
export { getCommandName, isCommandEnabled } from "./types.js";

import exit from "./exit/index.js";
import clear from "./clear/index.js";
import tools from "./tools/index.js";
import help from "./help/index.js";
import system from "./system/index.js";
import skills from "./skills/index.js";
import { loadSkillsFromSkillsDir } from "../skills/loadSkillsDir.js";

/** 所有内置命令列表（不含动态加载的 skills） */
export const BUILTIN_COMMANDS: Command[] = [
  exit,
  clear,
  tools,
  help,
  system,
  skills,
];

/**
 * 获取完整命令列表（包含动态加载的 skills）
 * @param skillsBasePath skills 目录路径
 * @returns 合并后的命令列表
 */
export async function getCommands(skillsBasePath?: string): Promise<Command[]> {
  const builtins = BUILTIN_COMMANDS;

  if (!skillsBasePath) {
    return builtins;
  }

  try {
    const loadedSkills = await loadSkillsFromSkillsDir(skillsBasePath, "bundled");
    return [...builtins, ...loadedSkills];
  } catch {
    // 动态加载失败时，返回内置命令作为 fallback
    return builtins;
  }
}

/**
 * 根据名称查找命令（支持别名）- 异步版本
 * @param commandName 命令名称（不含 /）
 * @param skillsBasePath skills 目录路径（可选）
 * @returns 匹配的 Command 或 undefined
 */
export async function findCommand(
  commandName: string,
  skillsBasePath?: string,
): Promise<Command | undefined> {
  const commands = await getCommands(skillsBasePath);
  return commands.find((cmd) =>
    cmd.name === commandName ||
    cmd.aliases?.includes(commandName) ||
    getCommandName(cmd) === commandName,
  );
}

/**
 * 根据名称查找命令（支持别名）- 同步版本（仅搜索内置命令）
 * @param commandName 命令名称（不含 /）
 * @param commands 命令列表
 * @returns 匹配的 Command 或 undefined
 */
export function findBuiltinCommand(
  commandName: string,
  commands: Command[] = BUILTIN_COMMANDS,
): Command | undefined {
  return commands.find((cmd) =>
    cmd.name === commandName ||
    cmd.aliases?.includes(commandName) ||
    getCommandName(cmd) === commandName,
  );
}

/** 所有可用命令列表（向后兼容，仅包含内置命令） */
export const COMMANDS: Command[] = BUILTIN_COMMANDS;

/** 命令执行结果 */
export interface ExecuteCommandResult {
  /** 是否匹配并执行了命令 */
  handled: boolean;
  /** 若为 local-jsx 命令，返回待渲染的 JSX */
  jsx?: React.ReactNode;
  /** 若为 local 命令，返回文本结果 */
  textResult?: string;
  /** 完成回调（local-jsx 命令使用） */
  onDone?: LocalJSXCommandOnDone;
}

/**
 * 执行 slash command
 * @param input 用户完整输入（如 "/exit"）
 * @param context 命令执行上下文
 * @param skillsBasePath skills 目录路径（可选，用于动态加载 skills）
 * @returns 执行结果
 */
export async function executeCommand(
  input: string,
  context: CommandContext,
  skillsBasePath?: string,
): Promise<ExecuteCommandResult> {
  const { parseSlashCommand } = await import("./parser.js");
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return { handled: false };
  }

  const { commandName, args } = parsed;
  const command = await findCommand(commandName, skillsBasePath);
  if (!command || !isCommandEnabled(command)) {
    return { handled: false };
  }

  if (command.type === "local") {
    try {
      const module = await command.load();
      const result = await module.call(args, context);
      if (result.type === "text") {
        return { handled: true, textResult: result.value };
      }
      return { handled: true };
    } catch {
      return { handled: false };
    }
  }

  if (command.type === "local-jsx") {
    try {
      const module = await command.load();
      let doneCalled = false;
      const onDone: LocalJSXCommandOnDone = (result) => {
        doneCalled = true;
        if (result) {
          context.appendSystemMessage(result);
        }
      };
      const jsx = await module.call(onDone, context, args);
      if (!doneCalled) {
        return { handled: true, jsx, onDone };
      }
      return { handled: true };
    } catch {
      return { handled: false };
    }
  }

  // prompt 类型命令：获取 skill 内容作为文本返回
  if (command.type === "prompt") {
    try {
      const contentBlocks = await command.getPromptForCommand(args);
      const textContent = contentBlocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
      return { handled: true, textResult: textContent };
    } catch {
      return { handled: false };
    }
  }

  return { handled: false };
}
