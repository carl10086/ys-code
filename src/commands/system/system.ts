import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async (_args, context) => {
  const promptText = context.session.getSystemPrompt();
  if (!promptText) {
    return { type: "text", value: "System prompt 尚未初始化。请先发起一次对话。" };
  }
  return { type: "text", value: promptText };
};
