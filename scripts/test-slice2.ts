import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServers } from "../src/mcp/index.js";

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-slice2-test-"));

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

  const tools = await loadMcpServers(tempDir);
  console.log("Loaded MCP tools:", tools.map((t) => t.name));

  const echoTool = tools.find((t) => t.name === "mcp__echo__echo");
  if (!echoTool) {
    throw new Error("echo tool not found");
  }

  const result = await echoTool.execute("tc-1", { message: "hello from slice2" }, {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    model: { id: "test", name: "test", api: "test", provider: "test", baseUrl: "", reasoning: false, input: [], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 0, maxTokens: 0 },
    fileStateCache: {} as any,
  });

  console.log("Tool execution result:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
