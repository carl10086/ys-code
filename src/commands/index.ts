// src/commands/index.ts
import { homedir } from "os";
import { join } from "path";
import type { Command, CommandContext, LocalJSXCommandOnDone } from "./types.js";
import { getCommandName, isCommandEnabled } from "./types.js";
import type React from "react";
import { logger } from "../utils/logger.js";

export type { Command, CommandContext, CommandResult } from "./types.js";
export { getCommandName, isCommandEnabled } from "./types.js";

import exit from "./exit/index.js";
import clear from "./clear/index.js";
import tools from "./tools/index.js";
import help from "./help/index.js";
import system from "./system/index.js";
import skills from "./skills/index.js";
import debug from "./debug/index.js";
import { loadSkillsFromSkillsDir } from "../skills/loadSkillsDir.js";
import { loadCommandsFromDir, getProjectCommandDirs } from "./loadCommandsDir.js";

/** 所有内置命令列表（不含动态加载的 skills） */
export const BUILTIN_COMMANDS: Command[] = [
  exit,
  clear,
  debug,
  tools,
  help,
  system,
  skills,
];

/**
 * 获取完整命令列表（包含内置命令、skills、用户级和项目级 commands）
 * @param skillsBasePath skills 目录路径
 * @param cwd 当前工作目录（用于项目级 commands 遍历）
 * @returns 合并后的命令列表
 */
export async function getCommands(
  skillsBasePath?: string,
  cwd: string = process.cwd()
): Promise<Command[]> {
  const commandMap = new Map<string, Command>();

  // 1. 内置命令（最低优先级）
  for (const cmd of BUILTIN_COMMANDS) {
    commandMap.set(cmd.name, cmd);
  }

  // 2. Skills
  if (skillsBasePath) {
    try {
      const loadedSkills = await loadSkillsFromSkillsDir(skillsBasePath, "bundled");
      for (const cmd of loadedSkills) {
        commandMap.set(cmd.name, cmd);
      }
    } catch {
      // 动态加载失败时，继续使用已加载的命令
      logger.warn("Failed to load skills from " + skillsBasePath);
    }
  }

  // 3. 用户级 commands
  try {
    const userCmds = await loadCommandsFromDir(
      join(homedir(), ".claude/commands"),
      "userSettings"
    );
    for (const cmd of userCmds) {
      commandMap.set(cmd.name, cmd);
    }
  } catch {
    // graceful degradation
  }

  // 4. 项目级 commands（最高优先级，后加载覆盖先加载）
  try {
    const projectDirs = await getProjectCommandDirs(cwd);
    for (const dir of projectDirs) {
      const projectCmds = await loadCommandsFromDir(dir, "projectSettings");
      for (const cmd of projectCmds) {
        commandMap.set(cmd.name, cmd);
      }
    }
  } catch {
    // graceful degradation
  }

  return Array.from(commandMap.values());
}

/**
 * 根据名称查找命令（支持别名）- 异步版本
 * @param commandName 命令名称（不含 /）
 * @param skillsBasePath skills 目录路径（可选）
 * @param cwd 当前工作目录（可选）
 * @returns 匹配的 Command 或 undefined
 */
export async function findCommand(
  commandName: string,
  skillsBasePath?: string,
  cwd?: string
): Promise<Command | undefined> {
  const commands = await getCommands(skillsBasePath, cwd);
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
  /** meta 消息内容（skill 内容，isMeta=true）*/
  metaMessages?: string[];
  /** 完成回调（local-jsx 命令使用） */
  onDone?: LocalJSXCommandOnDone;
}

/**
 * 执行 slash command
 * @param input 用户完整输入（如 "/exit"）
 * @param context 命令执行上下文
 * @param skillsBasePath skills 目录路径（可选，用于动态加载 skills）
 * @param cwd 当前工作目录（可选，用于项目级 commands 遍历）
 * @returns 执行结果
 */
export async function executeCommand(
  input: string,
  context: CommandContext,
  skillsBasePath?: string,
  cwd: string = process.cwd(),
): Promise<ExecuteCommandResult> {
  const { parseSlashCommand } = await import("./parser.js");
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return { handled: false };
  }

  const { commandName, args } = parsed;
  const command = await findCommand(commandName, skillsBasePath, cwd);
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

  // prompt 类型命令：获取 skill 内容作为 meta 消息返回
  if (command.type === "prompt") {
    try {
      logger.debug("Fetching skill content", { commandName });
      const contentBlocks = await command.getPromptForCommand(args);
      const textContent = contentBlocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
      logger.debug("Skill metaMessages generated", { metaMessagesCount: 1, contentLength: textContent.length });
      return { handled: true, metaMessages: [textContent] };
    } catch {
      return { handled: false };
    }
  }

  return { handled: false };
}
