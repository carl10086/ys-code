import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { validateServerName, loadMcpJson, writeMcpJson } from "./shared.js";

describe("validateServerName", () => {
  it("接受合法名称", () => {
    expect(() => validateServerName("demo")).not.toThrow();
    expect(() => validateServerName("my-server_123")).not.toThrow();
  });

  it("拒绝含空格的名称", () => {
    expect(() => validateServerName("demo server")).toThrow("Invalid server name");
  });

  it("拒绝含特殊字符的名称", () => {
    expect(() => validateServerName("demo@server")).toThrow("Invalid server name");
  });
});

describe("writeMcpJson", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("原子写入 .mcp.json", async () => {
    const config = {
      mcpServers: {
        demo: { command: "echo", transport: "stdio" as const },
      },
    };

    await writeMcpJson(tmpDir, config);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(config);
  });

  it("覆盖已有文件", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), "{}", "utf-8");

    const config = {
      mcpServers: {
        new: { url: "http://localhost:3000", transport: "http" as const },
      },
    };

    await writeMcpJson(tmpDir, config);

    const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(config);
  });
});

describe("loadMcpJson", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("读取存在的 .mcp.json", async () => {
    const config = { mcpServers: { demo: { command: "echo" } } };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config), "utf-8");

    const result = await loadMcpJson(tmpDir);
    expect(result.mcpServers.demo).toBeDefined();
  });

  it("缺失文件时返回空配置", async () => {
    const result = await loadMcpJson(tmpDir);
    expect(result.mcpServers).toEqual({});
  });
});
