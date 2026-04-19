import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async (_args, context) => {
  context.session.reset();
  return { type: "skip" };
};
