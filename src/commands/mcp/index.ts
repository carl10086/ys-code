import { Command } from "@commander-js/extra-typings";
import { createAddCommand } from "./add.js";
import { createRemoveCommand } from "./remove.js";
import { createListCommand } from "./list.js";

export function createMcpCommand(): Command {
  return new Command("mcp")
    .description("Manage MCP servers in .mcp.json")
    .addCommand(createAddCommand())
    .addCommand(createRemoveCommand())
    .addCommand(createListCommand());
}
