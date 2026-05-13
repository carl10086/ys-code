import { Type, type TSchema } from "@sinclair/typebox";
import { defineAgentTool } from "../agent/define-agent-tool.js";
import type { AgentTool } from "../agent/types.js";
import type { McpServerConnection } from "./transport.js";

export function createMcpListPromptsTool(
  connections: Map<string, McpServerConnection>,
): AgentTool<TSchema, unknown> {
  return defineAgentTool({
    name: "mcp__list_prompts",
    label: "List MCP Prompts",
    description:
      "List all available MCP prompts from connected servers. Returns { server, name, description } for each prompt.",
    parameters: Type.Object({}),
    outputSchema: Type.Any(),
    execute: async () => {
      const results: Array<{
        server: string;
        name: string;
        description?: string;
      }> = [];
      for (const [serverName, connection] of connections) {
        try {
          const prompts = await connection.listPrompts();
          for (const prompt of prompts) {
            results.push({
              server: serverName,
              name: prompt.name,
              description: prompt.description,
            });
          }
        } catch {
          // skip servers that don't support prompts
        }
      }
      return results;
    },
  }) as unknown as AgentTool<TSchema, unknown>;
}

export function createMcpGetPromptTool(
  connections: Map<string, McpServerConnection>,
): AgentTool<TSchema, unknown> {
  return defineAgentTool({
    name: "mcp__get_prompt",
    label: "Get MCP Prompt",
    description:
      "Get a prompt from a specific MCP server by name. Optionally pass arguments if the prompt requires them. Use list_prompts first to discover available prompts.",
    parameters: Type.Object({
      server: Type.String({ description: "MCP server name" }),
      name: Type.String({ description: "Prompt name" }),
      arguments: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Optional prompt arguments",
        }),
      ),
    }),
    outputSchema: Type.Any(),
    execute: async (_id, params) => {
      const connection = connections.get(params.server);
      if (!connection) {
        throw new Error(`MCP server "${params.server}" not found`);
      }
      return await connection.getPrompt(params.name, params.arguments);
    },
  }) as unknown as AgentTool<TSchema, unknown>;
}
