import { describe, it, expect, spyOn } from "bun:test";
import { createMcpServerConnection } from "./transport.js";
import { McpConnectionError } from "./errors.js";
import { logger } from "../utils/logger.js";

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

  it("为 http 配置创建 connection", () => {
    const conn = createMcpServerConnection("test", {
      url: "http://localhost:3000/mcp",
      transport: "http",
    });
    expect(conn.name).toBe("test");
    expect(conn.isConnected()).toBe(false);
  });

  it("未实现的 transport 抛出 McpConnectionError", () => {
    expect(() =>
      createMcpServerConnection("test", {
        url: "ws://localhost:3000",
        transport: "ws" as any,
      }),
    ).toThrow(McpConnectionError);
  });
});

describe("BaseMcpServerConnection stderr handling", () => {
  it("connect 失败时通过 logger.warn 输出累积的 stderr", async () => {
    const warnSpy = spyOn(logger, "warn");

    const conn = createMcpServerConnection("test-stderr", {
      command: "sh",
      args: ["-c", "echo oops 1>&2; exit 1"],
      transport: "stdio",
    });

    await expect(conn.connect()).rejects.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    const callArgs = warnSpy.mock.calls[0];
    expect(callArgs[0]).toContain("stderr");
    expect(callArgs[1]?.stderr).toContain("oops");

    warnSpy.mockRestore();
  });

  it("stderr 累积上限为 64KB，超限截断", async () => {
    const conn = createMcpServerConnection("test-cap", {
      command: "node",
      args: [
        "-e",
        "process.stderr.write('x'.repeat(100 * 1024)); setTimeout(() => process.exit(1), 100)",
      ],
      transport: "stdio",
    });

    await expect(conn.connect()).rejects.toThrow();

    // 通过反射读取 private stderrBuffer 验证上限
    const connAny = conn as any;
    const buffer = connAny.stderrBuffer as string;
    expect(buffer.length).toBeLessThanOrEqual(64 * 1024);
  });
});
