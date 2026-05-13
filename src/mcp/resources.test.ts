import { describe, it, expect } from "bun:test";
import {
  createMcpListResourcesTool,
  createMcpReadResourceTool,
} from "./resources.js";
import type { McpServerConnection } from "./transport.js";

function makeMockConnection(
  resources: Array<{ uri: string; name?: string }> = [],
  readResult?: unknown,
): McpServerConnection {
  return {
    name: "mock",
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    getCapabilities: () => ({}),
    listTools: async () => [],
    callTool: async () => ({}),
    listResources: async () => resources,
    readResource: async (_uri: string) => readResult ?? { contents: [] },
    listPrompts: async () => [],
    getPrompt: async () => ({}),
  };
}

describe("createMcpListResourcesTool", () => {
  it("返回所有 server 的 resource 列表", async () => {
    const connections = new Map<string, McpServerConnection>([
      [
        "fs",
        makeMockConnection([
          { uri: "file:///tmp/a.txt", name: "a" },
          { uri: "file:///tmp/b.txt", name: "b" },
        ]),
      ],
      ["empty", makeMockConnection([])],
    ]);

    const tool = createMcpListResourcesTool(connections);
    const result = await tool.execute("id-1", {}, {} as any);

    expect(result).toEqual([
      { server: "fs", uri: "file:///tmp/a.txt", name: "a" },
      { server: "fs", uri: "file:///tmp/b.txt", name: "b" },
    ]);
  });

  it("不支持 resources 的 server 被跳过", async () => {
    const failingConnection: McpServerConnection = {
      ...makeMockConnection(),
      async listResources() {
        throw new Error("not supported");
      },
    };

    const connections = new Map<string, McpServerConnection>([
      ["ok", makeMockConnection([{ uri: "file:///tmp/x.txt" }])],
      ["bad", failingConnection],
    ]);

    const tool = createMcpListResourcesTool(connections);
    const result = await tool.execute("id-2", {}, {} as any);

    expect(result).toEqual([{ server: "ok", uri: "file:///tmp/x.txt" }]);
  });
});

describe("createMcpReadResourceTool", () => {
  it("读取指定 server 的 resource", async () => {
    const connections = new Map<string, McpServerConnection>([
      [
        "fs",
        makeMockConnection([], { contents: [{ text: "hello" }] }),
      ],
    ]);

    const tool = createMcpReadResourceTool(connections);
    const result = await tool.execute(
      "id-3",
      { server: "fs", uri: "file:///tmp/a.txt" },
      {} as any,
    );

    expect(result).toEqual({ contents: [{ text: "hello" }] });
  });

  it("server 不存在时抛出错误", async () => {
    const connections = new Map<string, McpServerConnection>();
    const tool = createMcpReadResourceTool(connections);

    expect(
      tool.execute("id-4", { server: "missing", uri: "file:///x" }, {} as any),
    ).rejects.toThrow('MCP server "missing" not found');
  });
});
