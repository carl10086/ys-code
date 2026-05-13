import { describe, it, expect } from "bun:test";
import { createMcpServerConnection } from "./transport.js";
import { McpConnectionError } from "./errors.js";

describe("createMcpServerConnection", () => {
  it("为 stdio 配置创建 connection", () => {
    const conn = createMcpServerConnection("test", {
      command: "node",
      args: ["server.js"],
      transport: "stdio",
    });
    expect(conn.name).toBe("test");
    expect(conn.isConnected()).toBe(false);
  });

  it("未实现的 transport 抛出 McpConnectionError", () => {
    expect(() =>
      createMcpServerConnection("test", {
        url: "http://localhost:3000/mcp",
        transport: "http",
      }),
    ).toThrow(McpConnectionError);
  });
});
