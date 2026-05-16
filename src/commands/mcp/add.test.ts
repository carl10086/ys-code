import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createAddCommand } from "./add.js";

describe("mcp add", () => {
  let tmpDir: string;
  let originalCwd: typeof process.cwd;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-add-test-"));
    originalCwd = process.cwd.bind(process);
    process.cwd = () => tmpDir;
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("写入 stdio server 到 .mcp.json", async () => {
    const cmd = createAddCommand();
    await cmd.parseAsync(["node", "script", "demo", "echo", "hello"]);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.demo).toEqual({
      command: "echo",
      args: ["hello"],
      transport: "stdio",
    });
  });

  it("写入 http server 到 .mcp.json", async () => {
    const cmd = createAddCommand();
    await cmd.parseAsync([
      "node",
      "script",
      "api",
      "http://localhost:3000",
      "-t",
      "http",
    ]);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.api).toEqual({
      url: "http://localhost:3000",
      transport: "http",
    });
  });

  it("解析 -e KEY=VALUE 为 env", async () => {
    const cmd = createAddCommand();
    await cmd.parseAsync([
      "node",
      "script",
      "demo",
      "node",
      "-e",
      "API_KEY=secret",
      "-e",
      "DEBUG=1",
    ]);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.demo.env).toEqual({
      API_KEY: "secret",
      DEBUG: "1",
    });
  });

  it("URL 未指定 -t http 时自动修正并警告", async () => {
    const cmd = createAddCommand();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(" "));
    };

    try {
      await cmd.parseAsync([
        "node",
        "script",
        "api",
        "http://localhost:3000",
      ]);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("http");

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.api.transport).toBe("http");
  });

  it("非法 name（含空格）被拒绝", async () => {
    const cmd = createAddCommand();
    await expect(
      cmd.parseAsync(["node", "script", "demo server", "echo"]),
    ).rejects.toThrow("Invalid server name");
  });

  it("重复名称报错", async () => {
    const cmd = createAddCommand();
    await cmd.parseAsync(["node", "script", "demo", "echo"]);

    await expect(
      cmd.parseAsync(["node", "script", "demo", "echo"]),
    ).rejects.toThrow("already exists");
  });

  it("解析 -H KEY=VALUE 为 headers", async () => {
    const cmd = createAddCommand();
    await cmd.parseAsync([
      "node",
      "script",
      "api",
      "http://localhost:3000",
      "-H",
      "Authorization=Bearer token",
      "-H",
      "X-Custom=header",
    ]);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.api.headers).toEqual({
      Authorization: "Bearer token",
      "X-Custom": "header",
    });
  });

  it("https:// URL 自动识别为 http transport", async () => {
    const cmd = createAddCommand();
    await cmd.parseAsync([
      "node",
      "script",
      "secure-api",
      "https://localhost:3443/mcp",
    ]);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers["secure-api"].transport).toBe("http");
    expect(parsed.mcpServers["secure-api"].url).toBe("https://localhost:3443/mcp");
  });
});
