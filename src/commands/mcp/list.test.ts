import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createListCommand } from "./list.js";

describe("mcp list", () => {
  let tmpDir: string;
  let originalCwd: typeof process.cwd;
  let logs: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-list-test-"));
    originalCwd = process.cwd.bind(process);
    process.cwd = () => tmpDir;
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    console.log = console.log;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("列出所有 server", async () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], transport: "stdio" },
          api: { url: "http://localhost:3000", transport: "http" },
        },
      }),
      "utf-8",
    );

    const cmd = createListCommand();
    await cmd.parseAsync(["node", "script"]);

    expect(logs.some((line) => line.includes("fs"))).toBe(true);
    expect(logs.some((line) => line.includes("api"))).toBe(true);
    expect(logs.some((line) => line.includes("stdio"))).toBe(true);
    expect(logs.some((line) => line.includes("http"))).toBe(true);
  });

  it("空配置时输出提示", async () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({ mcpServers: {} }),
      "utf-8",
    );

    const cmd = createListCommand();
    await cmd.parseAsync(["node", "script"]);

    expect(logs.some((line) => line.includes("No MCP servers"))).toBe(true);
  });

  it("缺少 .mcp.json 时输出空配置提示", async () => {
    const cmd = createListCommand();
    await cmd.parseAsync(["node", "script"]);

    expect(logs.some((line) => line.includes("No MCP servers"))).toBe(true);
  });
});
