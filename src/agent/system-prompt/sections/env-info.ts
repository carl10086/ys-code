import type { SectionCompute } from "../types.js";

export const compute: SectionCompute = async (context) => {
  return [
    "# Environment",
    "You have been invoked in the following environment: ",
    `  - Primary working directory: ${context.cwd}`,
    `  - Current model: ${context.model.id}`,
  ].join("\n");
};
