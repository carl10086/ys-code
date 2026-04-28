import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getMemoryFiles, clearMemoryFilesCache, processMemoryFile, getClaudeMds } from "./claudemd.js";

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

  it("应递归发现 .claude/rules/ 目录下的 .md 文件", async () => {
    const rulesDir = join(tempDir, ".claude", "rules");
    const subDir = join(rulesDir, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(rulesDir, "a.md"), "# Rule A");
    writeFileSync(join(subDir, "b.md"), "# Rule B");

    const files = await getMemoryFiles(tempDir);
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("a.md"))).toBe(true);
    expect(paths.some((p) => p.includes("sub") && p.endsWith("b.md"))).toBe(true);
  });

  it("应向上遍历目录发现 CLAUDE.md", async () => {
    const subDir = join(tempDir, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Root");
    writeFileSync(join(subDir, "CLAUDE.md"), "# Sub");

    process.cwd = () => subDir;
    clearMemoryFilesCache();

    const files = await getMemoryFiles(subDir);
    const claudeFiles = files.filter((f) => f.path.endsWith("CLAUDE.md"));
    expect(claudeFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("缓存应生效且可被清除", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# V1");

    const files1 = await getMemoryFiles(tempDir);
    expect(files1[0].content).toBe("# V1");

    // 修改文件但不清理缓存
    writeFileSync(join(tempDir, "CLAUDE.md"), "# V2");
    const files2 = await getMemoryFiles(tempDir);
    expect(files2[0].content).toBe("# V1"); // 仍是旧内容

    // 清除缓存后应获取新内容
    clearMemoryFilesCache();
    const files3 = await getMemoryFiles(tempDir);
    expect(files3[0].content).toBe("# V2");
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

describe("processMemoryFile frontmatter & stripping", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claudemd-fm-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("paths 不匹配时应过滤掉文件", async () => {
    const rulePath = join(tempDir, "rule.md");
    writeFileSync(rulePath, "---\npaths:\n  - \"src/**/*.ts\"\n---\nRule content");
    const info = await processMemoryFile(rulePath, "project", { cwd: tempDir });
    expect(info).toBeNull();
  });

  it("应移除 HTML 块级注释", async () => {
    const mdPath = join(tempDir, "comment.md");
    writeFileSync(mdPath, "Hello\n\n<!-- hidden -->\n\nWorld");
    const info = await processMemoryFile(mdPath, "project");
    expect(info).not.toBeNull();
    expect(info!.content).not.toContain("<!-- hidden -->");
    expect(info!.content).toContain("Hello");
    expect(info!.content).toContain("World");
  });

  it("getClaudeMds 应返回格式化字符串", () => {
    const result = getClaudeMds([
      { path: "a.md", fullPath: "/a.md", content: "A", source: "project" },
      { path: "b.md", fullPath: "/b.md", content: "B", source: "project" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain("Contents of a.md (project instructions, checked into the codebase):");
    expect(result).toContain("A");
    expect(result).toContain("Contents of b.md (project instructions, checked into the codebase):");
    expect(result).toContain("B");
  });
});
