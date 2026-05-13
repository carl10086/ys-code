import { logger } from "../utils/logger.js";
import type { AgentTool } from "../agent/types.js";
import { loadMcpConfig } from "./config.js";
import { McpConnectionManager } from "./connection.js";
import { createMcpToolAdapter } from "./tools.js";

export async function loadMcpServers(cwd: string): Promise<AgentTool[]> {
  const config = await loadMcpConfig(cwd);
  const manager = new McpConnectionManager();
  await manager.connectAll(config);

  const tools: AgentTool[] = [];

  for (const [serverName, connection] of manager.getConnections()) {
    try {
      const capabilities = connection.getCapabilities() as
        | Record<string, unknown>
        | undefined;

      if (capabilities?.tools) {
        const result = await connection.listTools();
        for (const tool of result) {
          tools.push(
            createMcpToolAdapter(tool.name, serverName, tool, connection),
          );
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to fetch tools from MCP server "${serverName}"`,
        {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }
  }

  if (manager.getFailures().size > 0) {
    for (const [name, error] of manager.getFailures()) {
      logger.warn(`MCP server "${name}" connection failed`, {
        error: error.message,
      });
    }
  }

  return tools;
}
