import { Type } from "@sinclair/typebox";
import { defineAgentTool } from "../define-agent-tool.js";
import { createSubagent } from "../subagent/create-subagent.js";
import { Agent } from "../agent.js";
import type { AgentTool } from "../types.js";

const MAX_SUBAGENT_DEPTH = 3;

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

function isTextContent(c: unknown): c is { type: "text"; text: string } {
  return typeof c === "object" && c !== null && "type" in c && (c as any).type === "text";
}

export function createAgentTool(parentAgent: Agent, depth: number = 0): AgentTool<typeof inputSchema, AgentToolOutput> {
  return defineAgentTool({
    name: "Agent",
    label: "Agent",
    description: "Launch a new subagent to handle a specific task. Use this when you need to delegate work to a specialized worker that operates independently.",
    parameters: inputSchema,
    outputSchema,
    async execute(_toolCallId, params, context) {
      if (depth >= MAX_SUBAGENT_DEPTH) {
        throw new Error(`Subagent nesting depth exceeded (max: ${MAX_SUBAGENT_DEPTH})`);
      }

      const child = createSubagent(parentAgent);

      // 为子代理注册一个 depth + 1 的 AgentTool
      child.registerTool(createAgentTool(child, depth + 1));

      // 监听父代理的 abort 信号并传播到子代理
      let onAbort: (() => void) | undefined;
      if (context.abortSignal) {
        onAbort = () => child.abort();
        context.abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        await child.prompt(params.prompt);
        await child.waitForIdle();
      } finally {
        if (onAbort && context.abortSignal) {
          context.abortSignal.removeEventListener("abort", onAbort);
        }
      }

      const messages = child.state.messages;
      const lastAssistant = messages.findLast((m) => m.role === "assistant");

      if (!lastAssistant) {
        return { result: "No response from subagent" };
      }

      const text = lastAssistant.content
        .filter(isTextContent)
        .map((c) => c.text)
        .join("");

      return { result: text || "No text response from subagent" };
    },
    formatResult(output, _toolCallId) {
      return [{ type: "text", text: output.result }];
    },
  });
}
