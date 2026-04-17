import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getMemoryFiles, clearMemoryFilesCache } from "../claudemd.js";

describe("getMemoryFiles", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claudemd-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    clearMemoryFilesCache();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应发现当前目录下的 CLAUDE.md", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Hello");
    const files = await getMemoryFiles(tempDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.path.endsWith("CLAUDE.md"))).toBe(true);
  });
});
