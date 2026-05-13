import { describe, it, expect } from "bun:test";
import {
  createMcpListPromptsTool,
  createMcpGetPromptTool,
} from "./prompts.js";
import type { McpServerConnection } from "./transport.js";

function makeMockConnection(
  prompts: Array<{ name: string; description?: string }> = [],
  getPromptResult?: unknown,
): McpServerConnection {
  return {
    name: "mock",
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    getCapabilities: () => ({}),
    listTools: async () => [],
    callTool: async () => ({}),
    listResources: async () => [],
    readResource: async () => ({}),
    listPrompts: async () => prompts,
    getPrompt: async (_name: string, _args?: unknown) =>
      getPromptResult ?? { messages: [] },
  };
}

describe("createMcpListPromptsTool", () => {
  it("返回所有 server 的 prompt 列表", async () => {
    const connections = new Map<string, McpServerConnection>([
      [
        "prompts",
        makeMockConnection([
          { name: "summarize", description: "Summarize text" },
          { name: "translate", description: "Translate text" },
        ]),
      ],
      ["empty", makeMockConnection([])],
    ]);

    const tool = createMcpListPromptsTool(connections);
    const result = await tool.execute("id-1", {}, {} as any);

    expect(result).toEqual([
      { server: "prompts", name: "summarize", description: "Summarize text" },
      { server: "prompts", name: "translate", description: "Translate text" },
    ]);
  });

  it("不支持 prompts 的 server 被跳过", async () => {
    const failingConnection: McpServerConnection = {
      ...makeMockConnection(),
      async listPrompts() {
        throw new Error("not supported");
      },
    };

    const connections = new Map<string, McpServerConnection>([
      ["ok", makeMockConnection([{ name: "code_review" }])],
      ["bad", failingConnection],
    ]);

    const tool = createMcpListPromptsTool(connections);
    const result = await tool.execute("id-2", {}, {} as any);

    expect(result).toEqual([{ server: "ok", name: "code_review" }]);
  });
});

describe("createMcpGetPromptTool", () => {
  it("获取指定 server 的 prompt", async () => {
    const connections = new Map<string, McpServerConnection>([
      [
        "prompts",
        makeMockConnection([], { messages: [{ role: "user", content: { type: "text", text: "hi" } }] }),
      ],
    ]);

    const tool = createMcpGetPromptTool(connections);
    const result = await tool.execute(
      "id-3",
      { server: "prompts", name: "summarize" },
      {} as any,
    );

    expect(result).toEqual({
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    });
  });

  it("带 arguments 调用", async () => {
    let capturedArgs: unknown;
    const customConnection: McpServerConnection = {
      ...makeMockConnection(),
      async getPrompt(name: string, args?: unknown) {
        capturedArgs = args;
        return { name, args };
      },
    };

    const connections = new Map<string, McpServerConnection>([
      ["prompts", customConnection],
    ]);

    const tool = createMcpGetPromptTool(connections);
    await tool.execute(
      "id-4",
      { server: "prompts", name: "greet", arguments: { name: "world" } },
      {} as any,
    );

    expect(capturedArgs).toEqual({ name: "world" });
  });

  it("server 不存在时抛出错误", async () => {
    const connections = new Map<string, McpServerConnection>();
    const tool = createMcpGetPromptTool(connections);

    expect(
      tool.execute("id-5", { server: "missing", name: "x" }, {} as any),
    ).rejects.toThrow('MCP server "missing" not found');
  });
});
