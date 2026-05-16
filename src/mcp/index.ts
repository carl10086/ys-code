import { logger } from "../utils/logger.js";
import type { AgentTool } from "../agent/types.js";
import { loadMcpConfig } from "./config.js";
import { McpConnectionManager } from "./connection.js";
import { createMcpToolAdapter } from "./tools.js";
import {
  createMcpListResourcesTool,
  createMcpReadResourceTool,
} from "./resources.js";
import {
  createMcpListPromptsTool,
  createMcpGetPromptTool,
} from "./prompts.js";

export async function loadMcpServers(cwd: string): Promise<AgentTool[]> {
  const config = await loadMcpConfig(cwd);
  const manager = new McpConnectionManager();
  await manager.connectAll(config);

  const tools: AgentTool[] = [];
  const connections = manager.getConnections();
  let hasResources = false;
  let hasPrompts = false;

  for (const [serverName, connection] of connections) {
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

      if (capabilities?.resources) {
        hasResources = true;
      }
      if (capabilities?.prompts) {
        hasPrompts = true;
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

  if (hasResources) {
    tools.push(createMcpListResourcesTool(connections));
    tools.push(createMcpReadResourceTool(connections));
  }

  if (hasPrompts) {
    tools.push(createMcpListPromptsTool(connections));
    tools.push(createMcpGetPromptTool(connections));
  }

  const states = manager.getStates();
  for (const [name, state] of states) {
    if (state.kind === "failed") {
      logger.warn(`MCP server "${name}" connection failed`, {
        error: state.error.message,
      });
    }
    if (state.kind === "needs-auth") {
      logger.warn(`MCP server "${name}" needs authentication`, {
        reason: state.reason,
      });
    }
    if (state.kind === "pending") {
      logger.info(`MCP server "${name}" is reconnecting`);
    }
  }

  return tools;
}
