import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadCommandsFromDir, getProjectCommandDirs } from "./loadCommandsDir.js";
import type { PromptCommand } from "./types.js";

describe("loadCommandsFromDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "load-cmds-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("目录不存在时应返回空数组", async () => {
    const result = await loadCommandsFromDir(join(tempDir, "nonexistent"), "userSettings");
    expect(result).toEqual([]);
  });

  it("目录存在但无 .md 文件时应返回空数组", async () => {
    const emptyDir = join(tempDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const result = await loadCommandsFromDir(emptyDir, "userSettings");
    expect(result).toEqual([]);
  });

  it("应正确解析目录下的 .md 文件为 PromptCommand", async () => {
    const cmdsDir = join(tempDir, "commands");
    mkdirSync(cmdsDir, { recursive: true });

    writeFileSync(
      join(cmdsDir, "hello.md"),
      "---\ndescription: Say hello\n---\n# Hello\n\nThis is a hello command."
    );

    writeFileSync(
      join(cmdsDir, "world.md"),
      "---\ndescription: Say world\n---\n# World\n\nThis is a world command."
    );

    const result = await loadCommandsFromDir(cmdsDir, "userSettings");
    expect(result.length).toBe(2);

    const names = result.map((c: PromptCommand) => c.name).sort();
    expect(names).toEqual(["hello", "world"]);

    const helloCmd = result.find((c: PromptCommand) => c.name === "hello");
    expect(helloCmd).toBeDefined();
    expect(helloCmd!.description).toBe("Say hello");
    expect(helloCmd!.type).toBe("prompt");
    expect(helloCmd!.source).toBe("userSettings");
  });

  it("应忽略子目录中的 .md 文件", async () => {
    const cmdsDir = join(tempDir, "commands");
    const subDir = join(cmdsDir, "subdir");
    mkdirSync(subDir, { recursive: true });

    writeFileSync(
      join(cmdsDir, "root.md"),
      "---\ndescription: Root command\n---\n# Root"
    );
    writeFileSync(
      join(subDir, "ignored.md"),
      "---\ndescription: Ignored command\n---\n# Ignored"
    );

    const result = await loadCommandsFromDir(cmdsDir, "userSettings");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("root");
  });

  it("单个文件解析失败不应打断其他文件加载", async () => {
    const cmdsDir = join(tempDir, "commands");
    mkdirSync(cmdsDir, { recursive: true });

    writeFileSync(
      join(cmdsDir, "good.md"),
      "---\ndescription: Good command\n---\n# Good"
    );
    // 创建一个指向不存在文件的符号链接，使 readFile 抛出 ENOENT
    symlinkSync(
      join(cmdsDir, "nonexistent.md"),
      join(cmdsDir, "broken.md")
    );

    const result = await loadCommandsFromDir(cmdsDir, "userSettings");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("good");
  });

  it("应从 markdown 内容中提取 description（无 frontmatter 时）", async () => {
    const cmdsDir = join(tempDir, "commands");
    mkdirSync(cmdsDir, { recursive: true });

    writeFileSync(
      join(cmdsDir, "no-frontmatter.md"),
      "# No Frontmatter Command\n\nSome content here."
    );

    const result = await loadCommandsFromDir(cmdsDir, "userSettings");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("no-frontmatter");
    expect(result[0].description).toBe("No Frontmatter Command");
  });
});

describe("getProjectCommandDirs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "proj-cmds-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("cwd 下存在 .claude/commands/ 时应包含该路径", async () => {
    const projectDir = join(tempDir, "project");
    const cmdsDir = join(projectDir, ".claude", "commands");
    const gitDir = join(projectDir, ".git");
    mkdirSync(cmdsDir, { recursive: true });
    mkdirSync(gitDir, { recursive: true });

    const result = await getProjectCommandDirs(projectDir);
    expect(result).toContain(cmdsDir);
  });

  it("应向上遍历找到上级目录的 .claude/commands/", async () => {
    const projectDir = join(tempDir, "project");
    const srcDir = join(projectDir, "src");
    const cmdsDir = join(projectDir, ".claude", "commands");
    const gitDir = join(projectDir, ".git");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(cmdsDir, { recursive: true });
    mkdirSync(gitDir, { recursive: true });

    const result = await getProjectCommandDirs(srcDir);
    expect(result).toContain(cmdsDir);
  });

  it("多层目录存在时应按 cwd 优先排序", async () => {
    const rootDir = join(tempDir, "root");
    const subDir = join(rootDir, "packages", "app");
    const rootCmds = join(rootDir, ".claude", "commands");
    const subCmds = join(subDir, ".claude", "commands");
    const gitDir = join(rootDir, ".git");

    mkdirSync(subCmds, { recursive: true });
    mkdirSync(rootCmds, { recursive: true });
    mkdirSync(gitDir, { recursive: true });

    const result = await getProjectCommandDirs(subDir);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(subCmds); // cwd 优先
    expect(result[1]).toBe(rootCmds);
  });

  it("不在 git repo 中时应遍历到 home 停止（不越界）", async () => {
    const fakeHome = join(tempDir, "nogit");
    const projectDir = join(fakeHome, "project");
    const projectCmds = join(projectDir, ".claude", "commands");
    const homeCmds = join(fakeHome, ".claude", "commands");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectCmds, { recursive: true });
    mkdirSync(homeCmds, { recursive: true });

    // 传入 fakeHome 作为 home 参数
    const result = await getProjectCommandDirs(projectDir, fakeHome);
    expect(result).toContain(projectCmds);
    expect(result).not.toContain(homeCmds); // home 目录本身不纳入
    expect(result.length).toBe(1);
  });

  it("不应包含 home 目录本身的 .claude/commands/", async () => {
    // 创建模拟 home 目录结构
    const fakeHome = join(tempDir, "home");
    const homeCmds = join(fakeHome, ".claude", "commands");
    mkdirSync(homeCmds, { recursive: true });

    // 在 fakeHome 下创建一个项目（无 .git，因此遍历会到 fakeHome）
    const projectDir = join(fakeHome, "project");
    const projectCmds = join(projectDir, ".claude", "commands");
    mkdirSync(projectCmds, { recursive: true });

    // 传入 fakeHome 作为 home 参数
    const result = await getProjectCommandDirs(projectDir, fakeHome);
    expect(result).toContain(projectCmds);
    expect(result).not.toContain(homeCmds); // home 目录本身应被排除
  });

  it("无 .claude/commands/ 目录时应返回空数组", async () => {
    const emptyProject = join(tempDir, "empty-project");
    const gitDir = join(emptyProject, ".git");
    mkdirSync(emptyProject, { recursive: true });
    mkdirSync(gitDir, { recursive: true });

    const result = await getProjectCommandDirs(emptyProject);
    expect(result).toEqual([]);
  });
});
