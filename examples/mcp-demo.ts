#!/usr/bin/env bun
/**
 * MCP Client 集成 Demo
 *
 * 运行方式:
 *   bun run examples/mcp-demo.ts
 *
 * 前置条件:
 *   - 已安装 @modelcontextprotocol/sdk
 *   - bun 运行时可用
 *
 * 期望输出:
 *   1. 加载 .mcp.json 配置
 *   2. 连接 echo MCP server (stdio)
 *   3. 列出可用 tools / resources / prompts
 *   4. 执行 echo tool 并打印结果
 *   5. 断开连接并清理临时文件
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServers } from "../src/mcp/index.js";

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-demo-"));

  // 1. 准备 echo MCP server 脚本
  const serverScript = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "demo", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo the input message",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: req.params.arguments.message }],
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "demo:///readme", name: "Readme" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => ({
  contents: [{ uri: req.params.uri, mimeType: "text/plain", text: "Hello from demo resource!" }],
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    { name: "greet", description: "Greeting prompt" },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => ({
  messages: [
    { role: "user", content: { type: "text", text: "Hello, " + req.params.name } },
  ],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
`;

  writeFileSync(join(tempDir, "server.js"), serverScript);

  // 2. 写入 .mcp.json 配置
  writeFileSync(
    join(tempDir, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        demo: {
          command: "bun",
          args: [join(tempDir, "server.js")],
          transport: "stdio",
        },
      },
    }),
  );

  console.log("=".repeat(50));
  console.log(" MCP Client Demo");
  console.log("=".repeat(50));
  console.log("\n[1/4] Loading .mcp.json from:", tempDir);

  // 3. 加载 MCP servers
  const tools = await loadMcpServers(tempDir);

  console.log("[2/4] Loaded tools:");
  for (const tool of tools) {
    console.log(`  - ${tool.name} (${tool.label})`);
  }

  // 4. 执行 echo tool
  const echoTool = tools.find((t) => t.name === "mcp__demo__echo");
  if (!echoTool) {
    throw new Error("echo tool not found");
  }

  console.log("\n[3/4] Executing mcp__demo__echo...");
  const result = await echoTool.execute(
    "tc-demo-1",
    { message: "Hello from MCP demo!" },
    {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      model: {
        id: "test",
        name: "test",
        api: "test",
        provider: "test",
        baseUrl: "",
        reasoning: false,
        input: [],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 0,
        maxTokens: 0,
      },
      fileStateCache: {} as any,
    },
  );

  console.log("  Result:", JSON.stringify(result, null, 2));

  // 5. 调用 resource / prompt 工具
  const listResourcesTool = tools.find((t) => t.name === "mcp__list_resources");
  if (listResourcesTool) {
    console.log("\n[4/4] Listing resources...");
    const resources = await listResourcesTool.execute("tc-demo-2", {}, {} as any);
    console.log("  Resources:", JSON.stringify(resources, null, 2));
  }

  const listPromptsTool = tools.find((t) => t.name === "mcp__list_prompts");
  if (listPromptsTool) {
    const prompts = await listPromptsTool.execute("tc-demo-3", {}, {} as any);
    console.log("\n  Prompts:", JSON.stringify(prompts, null, 2));
  }

  console.log("\n" + "=".repeat(50));
  console.log(" Demo completed successfully!");
  console.log("=".repeat(50));

  // 清理
  rmSync(tempDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
