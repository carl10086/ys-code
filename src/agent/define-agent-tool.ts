import type { AgentTool } from "./types.js";
import type { Static, TSchema } from "@sinclair/typebox";

export function defineAgentTool<TParams extends TSchema, TOutput>(
  tool: AgentTool<TParams, TOutput>,
): AgentTool<TParams, TOutput> {
  return {
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    validateInput: async () => ({ ok: true }),
    checkPermissions: async () => ({ allowed: true }),
    formatResult: (output) => [{ type: "text", text: String(output) }],
    ...tool,
  };
}
