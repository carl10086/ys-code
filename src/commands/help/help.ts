// src/commands/help/help.ts
import type { LocalCommandCall } from "../types.js";
import { COMMANDS } from "../index.js";
import { getCommandName, isCommandEnabled } from "../types.js";

export const call: LocalCommandCall = async (_args, _context) => {
  const visibleCommands = COMMANDS
    .filter(cmd => !cmd.isHidden && isCommandEnabled(cmd))
    .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)));

  if (visibleCommands.length === 0) {
    return { type: "text", value: "暂无可用命令。" };
  }

  const lines = visibleCommands.map(cmd => {
    const name = getCommandName(cmd);
    const aliasText = cmd.aliases && cmd.aliases.length > 0
      ? ` (${cmd.aliases.join(", ")})`
      : "";
    const padding = " ".repeat(Math.max(1, 12 - name.length - aliasText.length));
    return `/${name}${aliasText}${padding}${cmd.description}`;
  });

  const value = ["可用命令：", "", ...lines].join("\n");
  return { type: "text", value };
};
