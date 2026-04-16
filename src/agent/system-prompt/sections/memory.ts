import type { SectionCompute } from "../types.js";

export const compute: SectionCompute = async (context) => {
  if (!context.memoryFiles || context.memoryFiles.length === 0) {
    return "";
  }
  return ["Memory content:", ...context.memoryFiles].join("\n");
};
