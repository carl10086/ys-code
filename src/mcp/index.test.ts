import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServers } from "./index.js";

describe("loadMcpServers", () => {
  it("文件不存在时返回空数组", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-index-test-"));
    const tools = await loadMcpServers(tempDir);
    expect(tools).toEqual([]);
  });

  it("配置解析错误时返回空数组", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-index-test-"));
    writeFileSync(join(tempDir, ".mcp.json"), "not json");
    await expect(loadMcpServers(tempDir)).rejects.toThrow();
  });
});
