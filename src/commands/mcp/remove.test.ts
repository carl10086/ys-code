import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createRemoveCommand } from "./remove.js";

describe("mcp remove", () => {
  let tmpDir: string;
  let originalCwd: typeof process.cwd;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-remove-test-"));
    originalCwd = process.cwd.bind(process);
    process.cwd = () => tmpDir;
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("移除已存在的 server", async () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { demo: { command: "echo" } } }),
      "utf-8",
    );

    const cmd = createRemoveCommand();
    await cmd.parseAsync(["node", "script", "demo"]);

    const content = JSON.parse(
      readFileSync(join(tmpDir, ".mcp.json"), "utf-8"),
    );
    expect(content.mcpServers.demo).toBeUndefined();
  });

  it("移除不存在的 server 报错", async () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({ mcpServers: {} }),
      "utf-8",
    );

    const cmd = createRemoveCommand();
    await expect(
      cmd.parseAsync(["node", "script", "missing"]),
    ).rejects.toThrow("not found");
  });

  it("非法 name（含空格）被拒绝", async () => {
    const cmd = createRemoveCommand();
    await expect(
      cmd.parseAsync(["node", "script", "demo server"]),
    ).rejects.toThrow("Invalid server name");
  });
});
