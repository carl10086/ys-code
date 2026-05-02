import type { Command } from "../types.js";

const compact = {
  type: "local",
  name: "compact",
  description: "压缩当前会话上下文",
  load: () => import("./compact.js"),
} satisfies Command;

export default compact;
