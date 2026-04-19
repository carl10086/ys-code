// src/commands/help/index.ts
import type { Command } from "../types.js";

const help = {
  type: "local",
  name: "help",
  description: "显示所有可用命令",
  load: () => import("./help.js"),
} satisfies Command;

export default help;
