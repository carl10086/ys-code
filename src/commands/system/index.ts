import type { Command } from "../../commands/types.js";

const system = {
  type: "local",
  name: "system",
  description: "显示当前 system prompt",
  load: () => import("./system.js"),
} satisfies Command;

export default system;
