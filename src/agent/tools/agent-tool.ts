import { Type } from "@sinclair/typebox";
import { defineAgentTool } from "../define-agent-tool.js";
import { createSubagent } from "../subagent/create-subagent.js";
import { Agent } from "../agent.js";
import type { AgentTool } from "../types.js";

const inputSchema = Type.Object({
  prompt: Type.String({ description: "The task for the subagent to complete" }),
  description: Type.Optional(Type.String({ description: "A description of the task" })),
});

const outputSchema = Type.Object({
  result: Type.String({ description: "The subagent's response" }),
});

type AgentToolInput = {
  prompt: string;
  description?: string;
};

type AgentToolOutput = {
  result: string;
};

export function createAgentTool(parentAgent: Agent): AgentTool<typeof inputSchema, AgentToolOutput> {
  return defineAgentTool({
    name: "Agent",
    label: "Agent",
    description: "Launch a new subagent to handle a specific task. Use this when you need to delegate work to a specialized worker that operates independently.",
    parameters: inputSchema,
    outputSchema,
    async execute(_toolCallId, params, _context) {
      const child = createSubagent(parentAgent, 0);

      await child.prompt(params.prompt);
      await child.waitForIdle();

      const messages = child.state.messages;
      const lastAssistant = messages.findLast((m) => m.role === "assistant");

      if (!lastAssistant) {
        return { result: "No response from subagent" };
      }

      const text = lastAssistant.content
        .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && "type" in c && c.type === "text")
        .map((c) => c.text)
        .join("");

      return { result: text || "No text response from subagent" };
    },
    formatResult(output, _toolCallId) {
      return [{ type: "text", text: output.result }];
    },
  });
}
