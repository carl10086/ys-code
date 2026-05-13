import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpConfig } from "./config.js";
import { McpConfigError } from "./errors.js";

describe("loadMcpConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("文件不存在时返回空配置", async () => {
    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers).toEqual({});
  });

  it("能解析有效的 stdio 配置", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env: { NODE_ENV: "production" },
          },
        },
      }),
    );

    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers).toHaveProperty("filesystem");
    expect(config.mcpServers.filesystem.command).toBe("npx");
    expect(config.mcpServers.filesystem.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
    ]);
    expect(config.mcpServers.filesystem.transport).toBe("stdio");
  });

  it("能解析有效的 http 配置", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          fetch: {
            url: "http://localhost:3000/mcp",
            transport: "http",
          },
        },
      }),
    );

    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers.fetch.url).toBe("http://localhost:3000/mcp");
    expect(config.mcpServers.fetch.transport).toBe("http");
  });

  it("自动推导 transport 默认值（command → stdio）", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          fs: { command: "node", args: ["server.js"] },
        },
      }),
    );

    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers.fs.transport).toBe("stdio");
  });

  it("自动推导 transport 默认值（url → http）", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          api: { url: "http://localhost:3000/mcp" },
        },
      }),
    );

    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers.api.transport).toBe("http");
  });

  it("展开 env 变量", async () => {
    process.env.TEST_MCP_VAR = "test-value";
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          fs: {
            command: "node",
            env: { API_KEY: "${TEST_MCP_VAR}" },
          },
        },
      }),
    );

    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers.fs.env?.API_KEY).toBe("test-value");
    delete process.env.TEST_MCP_VAR;
  });

  it("缺少 command 和 url 时抛出 McpConfigError", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          bad: { args: ["server.js"] },
        },
      }),
    );

    await expect(loadMcpConfig(tempDir)).rejects.toThrow(McpConfigError);
  });

  it("同时存在 command 和 url 时抛出 McpConfigError", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          bad: { command: "node", url: "http://localhost:3000/mcp" },
        },
      }),
    );

    expect(loadMcpConfig(tempDir)).rejects.toThrow(McpConfigError);
  });

  it("空 mcpServers 返回空对象", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({ mcpServers: {} }),
    );

    const config = await loadMcpConfig(tempDir);
    expect(config.mcpServers).toEqual({});
  });

  it("未知 transport 抛出 McpConfigError", async () => {
    writeFileSync(
      join(tempDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          custom: { command: "node", transport: "custom" as any },
        },
      }),
    );

    expect(loadMcpConfig(tempDir)).rejects.toThrow(McpConfigError);
  });
});
