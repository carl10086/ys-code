// src/commands/debug/index.ts
import type { Command } from "../../commands/types.js";

const debug = {
  type: "local",
  name: "debug",
  description: "导出当前会话上下文为 JSON 文件",
  load: () => import("./debug.js"),
} satisfies Command;

export default debug;
