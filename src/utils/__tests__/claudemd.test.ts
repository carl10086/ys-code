import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getMemoryFiles, clearMemoryFilesCache, processMemoryFile } from "../claudemd.js";

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

describe("processMemoryFile @include", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claudemd-include-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应递归内联 @include 指向的文件", async () => {
    const mainPath = join(tempDir, "main.md");
    const includePath = join(tempDir, "included.md");
    writeFileSync(mainPath, "Hello\n@./included.md\nWorld");
    writeFileSync(includePath, "Included content");

    const info = await processMemoryFile(mainPath, "project");
    expect(info).not.toBeNull();
    expect(info!.content).toBe("Hello\nIncluded content\nWorld");
  });

  it("应检测循环 include 并终止", async () => {
    const aPath = join(tempDir, "a.md");
    const bPath = join(tempDir, "b.md");
    writeFileSync(aPath, "A\n@./b.md");
    writeFileSync(bPath, "B\n@./a.md");

    const info = await processMemoryFile(aPath, "project");
    expect(info).not.toBeNull();
    expect(info!.content).toContain("A");
    expect(info!.content).toContain("B");
  });
});
