import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async (_args, context) => {
  const toolList = context.session.tools;
  if (toolList.length === 0) {
    return { type: "text", value: "当前没有可用工具。" };
  }

  const lines = toolList.map((tool) => {
    const desc = typeof tool.description === "string"
      ? tool.description
      : "(动态描述)";
    return `• ${tool.name}: ${desc}`;
  });

  const output = ["可用工具列表：", "", ...lines].join("\n");
  return { type: "text", value: output };
};
