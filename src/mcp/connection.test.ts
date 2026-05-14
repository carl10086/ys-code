import { describe, it, expect } from "bun:test";
import { McpConnectionManager, calculateBackoffDelay } from "./connection.js";
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

describe("calculateBackoffDelay", () => {
  it("退避序列符合 1s/2s/4s/8s/16s/30s", () => {
    expect(calculateBackoffDelay(0)).toBe(1000);
    expect(calculateBackoffDelay(1)).toBe(2000);
    expect(calculateBackoffDelay(2)).toBe(4000);
    expect(calculateBackoffDelay(3)).toBe(8000);
    expect(calculateBackoffDelay(4)).toBe(16000);
    expect(calculateBackoffDelay(5)).toBe(30000);
    expect(calculateBackoffDelay(10)).toBe(30000);
  });
});

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

  it("connect 超时后调用 disconnect() 一次", async () => {
    const manager = new McpConnectionManager();
    let disconnectCallCount = 0;

    const conn = createMockConnection({
      name: "slow",
      connect: () => new Promise(() => {}), // 永不 resolve
      disconnect: () => {
        disconnectCallCount++;
        return Promise.resolve();
      },
    });

    const originalTimeout = process.env.MCP_TIMEOUT;
    process.env.MCP_TIMEOUT = "100";

    await manager.connectAll(
      { mcpServers: { slow: { command: "node", transport: "stdio" } } },
      () => conn,
    );

    if (originalTimeout !== undefined) {
      process.env.MCP_TIMEOUT = originalTimeout;
    } else {
      delete process.env.MCP_TIMEOUT;
    }

    expect(manager.getConnections().size).toBe(0);
    expect(manager.getFailures().size).toBe(1);
    expect(disconnectCallCount).toBe(1);
    expect(manager.getFailures().get("slow")?.message).toContain("timed out");
  });

  it("getConnections 返回的是副本，外部修改不影响内部", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({ name: "fs" });

    await manager.connectAll(
      { mcpServers: { fs: { command: "node", transport: "stdio" } } },
      () => conn,
    );

    const connections = manager.getConnections();
    connections.clear();
    expect(manager.getConnections().size).toBe(1);
  });

  it("disconnect 异常被吞掉，不影响其他连接", async () => {
    const manager = new McpConnectionManager();
    const goodConn = createMockConnection({
      name: "good",
      disconnect: () => Promise.resolve(),
    });
    const badConn = createMockConnection({
      name: "bad",
      disconnect: () => Promise.reject(new Error("disconnect failed")),
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

    expect(manager.disconnectAll()).resolves.toBeUndefined();
    expect(manager.getConnections().size).toBe(0);
  });

  it("成功连接后状态为 connected", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({ name: "fs" });

    await manager.connectAll(
      { mcpServers: { fs: { command: "node", transport: "stdio" } } },
      () => conn,
    );

    const states = manager.getStates();
    expect(states.get("fs")?.kind).toBe("connected");
  });

  it("连接失败后状态为 failed", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({
      name: "bad",
      connect: () => Promise.reject(new Error("connection refused")),
    });

    await manager.connectAll(
      { mcpServers: { bad: { command: "node", transport: "stdio" } } },
      () => conn,
    );

    const states = manager.getStates();
    expect(states.get("bad")?.kind).toBe("failed");
  });

  it("stdio transport onclose 后状态变为 failed（不重连）", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({ name: "fs" });

    await manager.connectAll(
      { mcpServers: { fs: { command: "node", transport: "stdio" } } },
      () => conn,
    );

    expect(conn.onClose).toBeDefined();
    conn.onClose!();

    const states = manager.getStates();
    expect(states.get("fs")?.kind).toBe("failed");
  });

  it("http transport onclose 后状态变为 pending（计划重连）", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({ name: "api" });

    await manager.connectAll(
      { mcpServers: { api: { url: "http://localhost:3000", transport: "http" } } },
      () => conn,
    );

    expect(conn.onClose).toBeDefined();
    conn.onClose!();

    const states = manager.getStates();
    expect(states.get("api")?.kind).toBe("pending");
  });

  it("getConnections 只返回 connected 状态的连接", async () => {
    const manager = new McpConnectionManager();
    const goodConn = createMockConnection({ name: "good" });
    const badConn = createMockConnection({
      name: "bad",
      connect: () => Promise.reject(new Error("fail")),
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

    const connections = manager.getConnections();
    expect(connections.size).toBe(1);
    expect(connections.has("good")).toBe(true);
    expect(connections.has("bad")).toBe(false);
  });

  it("getFailures 只返回 failed 状态的错误", async () => {
    const manager = new McpConnectionManager();
    const badConn = createMockConnection({
      name: "bad",
      connect: () => Promise.reject(new Error("connection refused")),
    });

    await manager.connectAll(
      { mcpServers: { bad: { command: "node", transport: "stdio" } } },
      () => badConn,
    );

    const failures = manager.getFailures();
    expect(failures.size).toBe(1);
    expect(failures.get("bad")?.message).toBe("connection refused");
  });

  it("disconnectAll 清除所有状态和重连定时器", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({ name: "api" });

    await manager.connectAll(
      { mcpServers: { api: { url: "http://localhost:3000", transport: "http" } } },
      () => conn,
    );

    // Trigger onclose to schedule reconnect
    conn.onClose!();
    expect(manager.getStates().get("api")?.kind).toBe("pending");

    // disconnectAll should clear everything
    await manager.disconnectAll();
    expect(manager.getStates().size).toBe(0);
    expect(manager.getConnections().size).toBe(0);
  });

  it("reconnect() 从 failed 状态恢复为 connected", async () => {
    const manager = new McpConnectionManager();
    let shouldFail = true;

    const conn = createMockConnection({
      name: "api",
      connect: () => {
        if (shouldFail) {
          return Promise.reject(new Error("temporarily unavailable"));
        }
        return Promise.resolve();
      },
    });

    await manager.connectAll(
      { mcpServers: { api: { url: "http://localhost:3000", transport: "http" } } },
      () => conn,
    );

    expect(manager.getStates().get("api")?.kind).toBe("failed");

    shouldFail = false;
    await manager.reconnect("api");

    expect(manager.getStates().get("api")?.kind).toBe("connected");
    expect(manager.getConnections().has("api")).toBe(true);
  });

  it("reconnect() 遇 401 错误进入 needs-auth 状态", async () => {
    const manager = new McpConnectionManager();
    const conn = createMockConnection({
      name: "api",
      connect: () =>
        Promise.reject(new Error("401 Unauthorized: invalid token")),
    });

    await manager.connectAll(
      { mcpServers: { api: { url: "http://localhost:3000", transport: "http" } } },
      () => conn,
    );

    expect(manager.getStates().get("api")?.kind).toBe("failed");

    await manager.reconnect("api");

    const state = manager.getStates().get("api");
    expect(state?.kind).toBe("needs-auth");
    if (state?.kind === "needs-auth") {
      expect(state.reason).toContain("Unauthorized");
    }
  });
});
