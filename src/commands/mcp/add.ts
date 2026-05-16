import { Command } from "@commander-js/extra-typings";
import { validateServerName, loadMcpJson, writeMcpJson } from "./shared.js";

function collectEnv(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const idx = value.indexOf("=");
  if (idx === -1) {
    throw new Error(`Invalid env format: "${value}". Expected KEY=VALUE`);
  }
  previous[value.slice(0, idx)] = value.slice(idx + 1);
  return previous;
}

function collectHeader(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const idx = value.indexOf("=");
  if (idx === -1) {
    throw new Error(`Invalid header format: "${value}". Expected KEY=VALUE`);
  }
  previous[value.slice(0, idx)] = value.slice(idx + 1);
  return previous;
}

export function createAddCommand() {
  return new Command("add")
    .description("Add an MCP server to .mcp.json")
    .argument("<name>", "Server name")
    .argument("<commandOrUrl>", "Command or URL")
    .argument("[args...]", "Command arguments (for stdio transport)")
    .option("-t, --transport <type>", "Transport type (stdio or http)", "stdio")
    .option(
      "-e, --env <KEY=VALUE>",
      "Environment variables (repeatable)",
      collectEnv,
      {} as Record<string, string>,
    )
    .option(
      "-H, --header <KEY=VALUE>",
      "HTTP headers (repeatable)",
      collectHeader,
      {} as Record<string, string>,
    )
    .action(async (name, commandOrUrl, args, options) => {
      validateServerName(name);

      const isUrl =
        commandOrUrl.startsWith("http://") ||
        commandOrUrl.startsWith("https://");

      let transport = options.transport;
      if (isUrl && transport !== "http") {
        console.warn(
          `Warning: "${commandOrUrl}" looks like a URL but transport is "${transport}". Using "http".`,
        );
        transport = "http";
      }

      const config = await loadMcpJson(process.cwd());

      if (config.mcpServers[name]) {
        throw new Error(
          `MCP server "${name}" already exists. Use "remove" first or choose a different name.`,
        );
      }

      const serverConfig: Record<string, unknown> = {
        transport,
      };

      if (isUrl) {
        serverConfig.url = commandOrUrl;
        if (Object.keys(options.header).length > 0) {
          serverConfig.headers = options.header;
        }
      } else {
        serverConfig.command = commandOrUrl;
        if (args.length > 0) {
          serverConfig.args = args;
        }
      }

      if (Object.keys(options.env).length > 0) {
        serverConfig.env = options.env;
      }

      config.mcpServers[name] = serverConfig as {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        transport?: "stdio" | "http";
      };

      await writeMcpJson(process.cwd(), config);
      console.log(`Added MCP server "${name}" (${transport})`);
    });
}
