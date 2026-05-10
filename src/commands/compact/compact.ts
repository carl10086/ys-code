import type { LocalCommandCall } from "../types.js";

export const call: LocalCommandCall = async (args, context) => {
  const trimmedArgs = args.trim();
  const commandText = trimmedArgs
    ? `/compact ${trimmedArgs}`
    : "/compact";
  const result = await context.session.compact({
    commandText,
    instructions: trimmedArgs || undefined,
  });

  return {
    type: "compact",
    displayText: result.displayText,
  };
};
