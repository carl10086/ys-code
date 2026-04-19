import type { Command } from "../../commands/types.js";

const tools = {
  type: "local",
  name: "tools",
  description: "列出所有可用工具",
  load: () => import("./tools.js"),
} satisfies Command;

export default tools;
