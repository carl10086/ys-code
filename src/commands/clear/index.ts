import type { Command } from "../../commands/types.js";

const clear = {
  type: "local",
  name: "clear",
  aliases: ["new", "reset"],
  description: "清空会话历史",
  load: () => import("./clear.js"),
} satisfies Command;

export default clear;
