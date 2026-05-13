import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpConfig } from "../src/mcp/config.js";
import { McpConnectionManager } from "../src/mcp/connection.js";

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-slice1-test-"));

  // 准备一个 echo MCP server（用 bun 运行 ESM）
  const serverScript = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "echo", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo input",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: req.params.arguments.message }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
`;

  writeFileSync(join(tempDir, "server.js"), serverScript);

  writeFileSync(
    join(tempDir, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        echo: {
          command: "bun",
          args: [join(tempDir, "server.js")],
          transport: "stdio",
        },
      },
    }),
  );

  const config = await loadMcpConfig(tempDir);
  console.log("Config loaded:", Object.keys(config.mcpServers));

  const manager = new McpConnectionManager();
  await manager.connectAll(config);

  console.log("Connected:", Array.from(manager.getConnections().keys()));
  console.log("Failures:", Array.from(manager.getFailures().entries()));

  const echoConn = manager.getConnections().get("echo");
  if (echoConn) {
    const caps = echoConn.getCapabilities();
    console.log("Capabilities:", JSON.stringify(caps, null, 2));

    const tools = await echoConn.listTools();
    console.log("Tools:", JSON.stringify(tools, null, 2));

    const result = await echoConn.callTool("echo", { message: "hello from slice1" });
    console.log("Tool result:", JSON.stringify(result, null, 2));

    await echoConn.disconnect();
    console.log("Disconnected");
  }
}

main().catch(console.error);
