import { Type, type TSchema } from "@sinclair/typebox";
import { defineAgentTool } from "../agent/define-agent-tool.js";
import type { AgentTool } from "../agent/types.js";
import type { McpServerConnection } from "./transport.js";
import { jsonSchemaToTypeBox } from "./utils.js";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function getNamespacedToolName(
  serverName: string,
  toolName: string,
): string {
  return `mcp__${sanitizeName(serverName)}__${sanitizeName(toolName)}`;
}

export function createMcpToolAdapter(
  toolName: string,
  serverName: string,
  mcpTool: {
    name: string;
    description?: string;
    inputSchema: unknown;
  },
  connection: McpServerConnection,
): AgentTool<TSchema, unknown> {
  const name = getNamespacedToolName(serverName, toolName);
  const parameters = jsonSchemaToTypeBox(mcpTool.inputSchema);

  return defineAgentTool({
    name,
    label: toolName,
    description: mcpTool.description ?? `MCP tool: ${toolName}`,
    parameters,
    outputSchema: Type.Any(),
    execute: async (_toolCallId, params, _context) => {
      const result = await connection.callTool(toolName, params);
      return result;
    },
  });
}
