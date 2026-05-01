import type { LocalCommandCall } from "../types.js";

export const call: LocalCommandCall = async (args, context) => {
  const commandText = args.trim()
    ? `/compact ${args.trim()}`
    : "/compact";
  const result = await context.session.compact({
    commandText,
    instructions: args.trim() || undefined,
  });

  return {
    type: "compact",
    displayText: result.displayText,
  };
};
