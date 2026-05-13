import { Type, type TSchema } from "@sinclair/typebox";
import { defineAgentTool } from "../agent/define-agent-tool.js";
import type { AgentTool } from "../agent/types.js";
import type { McpServerConnection } from "./transport.js";

const ListResourcesSchema = Type.Object({});
type ListResourcesOutput = Array<{
  server: string;
  uri: string;
  name?: string;
}>;

export function createMcpListResourcesTool(
  connections: Map<string, McpServerConnection>,
): AgentTool<TSchema, unknown> {
  return defineAgentTool({
    name: "mcp__list_resources",
    label: "List MCP Resources",
    description:
      "List all available MCP resources from connected servers. Returns { server, uri, name } for each resource.",
    parameters: ListResourcesSchema,
    outputSchema: Type.Any(),
    execute: async () => {
      const results: ListResourcesOutput = [];
      for (const [serverName, connection] of connections) {
        try {
          const resources = await connection.listResources();
          for (const resource of resources) {
            results.push({
              server: serverName,
              uri: resource.uri,
              name: resource.name,
            });
          }
        } catch {
          // skip servers that don't support resources
        }
      }
      return results;
    },
  }) as unknown as AgentTool<TSchema, unknown>;
}

const ReadResourceSchema = Type.Object({
  server: Type.String({ description: "MCP server name" }),
  uri: Type.String({ description: "Resource URI" }),
});

export function createMcpReadResourceTool(
  connections: Map<string, McpServerConnection>,
): AgentTool<TSchema, unknown> {
  return defineAgentTool({
    name: "mcp__read_resource",
    label: "Read MCP Resource",
    description:
      "Read a resource from a specific MCP server by URI. Use list_resources first to discover available URIs.",
    parameters: ReadResourceSchema,
    outputSchema: Type.Any(),
    execute: async (_id, params) => {
      const connection = connections.get(params.server);
      if (!connection) {
        throw new Error(`MCP server "${params.server}" not found`);
      }
      return await connection.readResource(params.uri);
    },
  }) as unknown as AgentTool<TSchema, unknown>;
}
