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

/** 所有可用命令列表 */
export const COMMANDS: Command[] = [
  exit,
  clear,
  tools,
  help,
  system,
];

/**
 * 根据名称查找命令（支持别名）
 * @param commandName 命令名称（不含 /）
 * @param commands 命令列表
 * @returns 匹配的 Command 或 undefined
 */
export function findCommand(
  commandName: string,
  commands: Command[] = COMMANDS,
): Command | undefined {
  return commands.find((cmd) =>
    cmd.name === commandName ||
    cmd.aliases?.includes(commandName) ||
    getCommandName(cmd) === commandName,
  );
}

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
 * @returns 执行结果
 */
export async function executeCommand(
  input: string,
  context: CommandContext,
): Promise<ExecuteCommandResult> {
  const { parseSlashCommand } = await import("./parser.js");
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return { handled: false };
  }

  const { commandName, args } = parsed;
  const command = findCommand(commandName);
  if (!command || !isCommandEnabled(command)) {
    return { handled: false };
  }

  if (command.type === "local") {
    const module = await command.load();
    const result = await module.call(args, context);
    if (result.type === "text") {
      return { handled: true, textResult: result.value };
    }
    return { handled: true };
  }

  if (command.type === "local-jsx") {
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
  }

  return { handled: false };
}
