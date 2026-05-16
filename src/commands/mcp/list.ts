import { Command } from "@commander-js/extra-typings";
import { loadMcpJson } from "./shared.js";

export function createListCommand() {
  return new Command("list")
    .description("List all MCP servers in .mcp.json")
    .action(async () => {
      const config = await loadMcpJson(process.cwd());
      const servers = Object.entries(config.mcpServers);

      if (servers.length === 0) {
        console.log("No MCP servers configured.");
        return;
      }

      console.log("NAME\t\tTRANSPORT\tTARGET");
      console.log("-".repeat(50));

      for (const [name, serverConfig] of servers) {
        const transport = serverConfig.transport ?? "stdio";
        const target =
          serverConfig.url ??
          (serverConfig.command
            ? [serverConfig.command, ...(serverConfig.args ?? [])].join(" ")
            : "unknown");
        console.log(`${name}\t\t${transport}\t\t${target}`);
      }
    });
}
