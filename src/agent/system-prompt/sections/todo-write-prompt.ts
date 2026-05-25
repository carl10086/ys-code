import type { SectionCompute } from "../types.js";

export const compute: SectionCompute = async (context) => {
  const todoWrite = context.tools.find((tool) => tool.name === "TodoWrite");
  if (!todoWrite?.prompt) {
    return "";
  }

  return todoWrite.prompt;
};
