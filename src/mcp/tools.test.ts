import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { createMcpToolAdapter } from "./tools.js";
import type { McpServerConnection } from "./transport.js";

function createMockConnection(
  overrides: Partial<McpServerConnection> = {},
): McpServerConnection {
  return {
    name: "mock",
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    isConnected: () => true,
    getCapabilities: () => ({}),
    listTools: () => Promise.resolve([]),
    callTool: () => Promise.resolve({ content: [] }),
    listResources: () => Promise.resolve([]),
    readResource: () => Promise.resolve({}),
    listPrompts: () => Promise.resolve([]),
    getPrompt: () => Promise.resolve({}),
    ...overrides,
  };
}

describe("createMcpToolAdapter", () => {
  it("创建正确的 AgentTool 结构", () => {
    const connection = createMockConnection();
    const tool = createMcpToolAdapter("echo", "test-server", {
      name: "echo",
      description: "Echo input",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
    }, connection);

    expect(tool.name).toBe("mcp__test_server__echo");
    expect(tool.label).toBe("echo");
    expect(tool.description).toBe("Echo input");
  });

  it("namespacing 处理非法字符", () => {
    const connection = createMockConnection();
    const tool = createMcpToolAdapter("my.tool", "server@1", {
      name: "my.tool",
      description: "Test",
      inputSchema: { type: "object" },
    }, connection);

    expect(tool.name).toBe("mcp__server_1__my_tool");
  });

  it("execute 调用 connection.callTool", async () => {
    let calledName = "";
    let calledArgs: unknown = null;

    const connection = createMockConnection({
      callTool: async (name, args) => {
        calledName = name;
        calledArgs = args;
        return { content: [{ type: "text", text: "hello" }] };
      },
    });

    const tool = createMcpToolAdapter("echo", "test", {
      name: "echo",
      description: "Echo",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
    }, connection);

    await tool.execute("tc-1", { message: "world" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      model: { id: "test", name: "test", api: "test", provider: "test", baseUrl: "", reasoning: false, input: [], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 0, maxTokens: 0 },
      fileStateCache: {} as any,
    });

    expect(calledName).toBe("echo");
    expect(calledArgs).toEqual({ message: "world" });
  });

  it("parameters 使用 jsonSchemaToTypeBox 转换", () => {
    const connection = createMockConnection();
    const tool = createMcpToolAdapter("calc", "math", {
      name: "calc",
      description: "Calc",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a"],
      },
    }, connection);

    expect(tool.parameters).toEqual(
      Type.Object({
        a: Type.Number(),
        b: Type.Optional(Type.Number()),
      }),
    );
  });
});
