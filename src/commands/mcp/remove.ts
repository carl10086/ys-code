import { Command } from "@commander-js/extra-typings";
import { validateServerName, loadMcpJson, writeMcpJson } from "./shared.js";

export function createRemoveCommand() {
  return new Command("remove")
    .description("Remove an MCP server from .mcp.json")
    .argument("<name>", "Server name")
    .action(async (name) => {
      validateServerName(name);

      const config = await loadMcpJson(process.cwd());

      if (!config.mcpServers[name]) {
        throw new Error(`MCP server "${name}" not found in .mcp.json`);
      }

      delete config.mcpServers[name];
      await writeMcpJson(process.cwd(), config);
      console.log(`Removed MCP server "${name}"`);
    });
}
