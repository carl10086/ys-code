import { describe, it, expect } from "bun:test";
import { McpConnectionManager } from "./connection.js";
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
    callTool: () => Promise.resolve({}),
    listResources: () => Promise.resolve([]),
    readResource: () => Promise.resolve({}),
    listPrompts: () => Promise.resolve([]),
    getPrompt: () => Promise.resolve({}),
    ...overrides,
  };
}

describe("McpConnectionManager", () => {
  it("成功连接所有 server", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({ name: "fs" });

    await manager.connectAll(
      {
        mcpServers: {
          fs: { command: "node", transport: "stdio" },
        },
      },
      () => conn,
    );

    expect(manager.getConnections().size).toBe(1);
    expect(manager.getFailures().size).toBe(0);
  });

  it("连接失败时记录错误且不阻断其他 server", async () => {
    const manager = new McpConnectionManager();
    const goodConn = createMockConnection({ name: "good" });
    const badConn = createMockConnection({
      name: "bad",
      connect: () => Promise.reject(new Error("connection refused")),
    });

    let callCount = 0;
    await manager.connectAll(
      {
        mcpServers: {
          good: { command: "node", transport: "stdio" },
          bad: { command: "node", transport: "stdio" },
        },
      },
      () => {
        callCount++;
        return callCount === 1 ? goodConn : badConn;
      },
    );

    expect(manager.getConnections().size).toBe(1);
    expect(manager.getFailures().size).toBe(1);
    expect(manager.getFailures().get("bad")?.message).toBe("connection refused");
  });

  it("disconnectAll 断开所有连接", async () => {
    const manager = new McpConnectionManager();
    let disconnected = false;
    const conn = createMockConnection({
      name: "fs",
      disconnect: () => {
        disconnected = true;
        return Promise.resolve();
      },
    });

    await manager.connectAll(
      {
        mcpServers: { fs: { command: "node", transport: "stdio" } },
      },
      () => conn,
    );

    await manager.disconnectAll();
    expect(disconnected).toBe(true);
    expect(manager.getConnections().size).toBe(0);
  });
});
