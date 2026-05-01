import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getCommands, findCommand, executeCommand, BUILTIN_COMMANDS } from "./index.js";
import type { Command } from "./types.js";

describe("commands/index", () => {
  it("getCommands() 不传参数时至少返回内置命令（向后兼容）", async () => {
    const commands = await getCommands();
    // 环境中可能存在 ~/.claude/commands/，因此命令数可能大于内置命令数
    expect(commands.length).toBeGreaterThanOrEqual(BUILTIN_COMMANDS.length);

    // 内置命令必须存在
    for (const builtin of BUILTIN_COMMANDS) {
      expect(commands.some((c) => c.name === builtin.name)).toBe(true);
    }
  });

  it("getCommands(skillsBasePath) 仍有效（向后兼容）", async () => {
    const commands = await getCommands(".claude/skills");
    // 至少包含内置命令
    expect(commands.length).toBeGreaterThanOrEqual(BUILTIN_COMMANDS.length);
  });
});

describe("commands/index integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cmd-idx-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  it("project 级命令应覆盖 user 级命令", async () => {
    const fakeHome = join(tempDir, "home");
    const fakeProject = join(tempDir, "project");
    const userCmdsDir = join(fakeHome, ".claude", "commands");
    const projCmdsDir = join(fakeProject, ".claude", "commands");

    mkdirSync(userCmdsDir, { recursive: true });
    mkdirSync(projCmdsDir, { recursive: true });
    mkdirSync(join(fakeProject, ".git"), { recursive: true });

    writeFileSync(
      join(userCmdsDir, "testcmd.md"),
      "---\ndescription: user-level\n---\n# User Level"
    );
    writeFileSync(
      join(projCmdsDir, "testcmd.md"),
      "---\ndescription: project-level\n---\n# Project Level"
    );

    mock.module("os", () => ({
      homedir: () => fakeHome,
    }));

    const commands = await getCommands(undefined, fakeProject);
    const testcmd = commands.find((c) => c.name === "testcmd");
    expect(testcmd).toBeDefined();
    expect(testcmd!.description).toBe("project-level");
  });

  it("findCommand 应能按 cwd 找到项目级命令", async () => {
    const fakeHome = join(tempDir, "home");
    const fakeProject = join(tempDir, "project");
    const projCmdsDir = join(fakeProject, ".claude", "commands");

    mkdirSync(projCmdsDir, { recursive: true });
    mkdirSync(join(fakeProject, ".git"), { recursive: true });

    writeFileSync(
      join(projCmdsDir, "projcmd.md"),
      "---\ndescription: Project Only\n---\n# Project Only"
    );

    mock.module("os", () => ({
      homedir: () => fakeHome,
    }));

    const cmd = await findCommand("projcmd", undefined, fakeProject);
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("projcmd");
    expect(cmd!.description).toBe("Project Only");
  });

  it("findCommand 应能找到内置 compact 命令", async () => {
    const cmd = await findCommand("compact");

    expect(cmd).toBeDefined();
    expect(cmd!.type).toBe("local");
    expect(cmd!.name).toBe("compact");
  });

  it("executeCommand 应正确传递 cwd 以解析项目级命令", async () => {
    const fakeHome = join(tempDir, "home");
    const fakeProject = join(tempDir, "project");
    const projCmdsDir = join(fakeProject, ".claude", "commands");

    mkdirSync(projCmdsDir, { recursive: true });
    mkdirSync(join(fakeProject, ".git"), { recursive: true });

    writeFileSync(
      join(projCmdsDir, "greet.md"),
      "---\ndescription: Greet\n---\n# Greet\n\nHello $ARGUMENTS!"
    );

    mock.module("os", () => ({
      homedir: () => fakeHome,
    }));

    const result = await executeCommand(
      "/greet world",
      {
        session: {} as any,
        appendUserMessage: () => {},
        appendSystemMessage: () => {},
        resetSession: () => {},
      },
      undefined,
      fakeProject
    );
    expect(result.handled).toBe(true);
    expect(result.metaMessages).toBeDefined();
    expect(result.metaMessages![0]).toContain("Hello world!");
  });

  it("executeCommand 应阻止 userInvocable=false 的命令", async () => {
    const fakeHome = join(tempDir, "home");
    const fakeProject = join(tempDir, "project");
    const projCmdsDir = join(fakeProject, ".claude", "commands");

    mkdirSync(projCmdsDir, { recursive: true });
    mkdirSync(join(fakeProject, ".git"), { recursive: true });

    writeFileSync(
      join(projCmdsDir, "modelonly.md"),
      "---\ndescription: Model Only\nuser-invocable: false\n---\n# Model Only"
    );

    mock.module("os", () => ({
      homedir: () => fakeHome,
    }));

    const result = await executeCommand(
      "/modelonly",
      {
        session: {} as any,
        appendUserMessage: () => {},
        appendSystemMessage: () => {},
        resetSession: () => {},
      },
      undefined,
      fakeProject
    );
    expect(result.handled).toBe(true);
    expect(result.textResult).toContain("can only be invoked by the model");
  });

  it("executeCommand 应允许 userInvocable=true 的命令", async () => {
    const fakeHome = join(tempDir, "home");
    const fakeProject = join(tempDir, "project");
    const projCmdsDir = join(fakeProject, ".claude", "commands");

    mkdirSync(projCmdsDir, { recursive: true });
    mkdirSync(join(fakeProject, ".git"), { recursive: true });

    writeFileSync(
      join(projCmdsDir, "usercmd.md"),
      "---\ndescription: User Cmd\nuser-invocable: true\n---\n# User Cmd"
    );

    mock.module("os", () => ({
      homedir: () => fakeHome,
    }));

    const result = await executeCommand(
      "/usercmd",
      {
        session: {} as any,
        appendUserMessage: () => {},
        appendSystemMessage: () => {},
        resetSession: () => {},
      },
      undefined,
      fakeProject
    );
    expect(result.handled).toBe(true);
    expect(result.metaMessages).toBeDefined();
    expect(result.metaMessages![0]).toContain("# User Cmd");
  });

  it("executeCommand 应将 compact local command 标记为不继续 query 的结果", async () => {
    const compactCommand = {
      type: "local",
      name: "fakecompact",
      description: "Fake compact command",
      load: async () => ({
        call: async () => ({
          type: "compact",
          displayText: "Compacted",
        }),
      }),
    } satisfies Command;
    BUILTIN_COMMANDS.push(compactCommand);

    try {
      const result = await executeCommand(
        "/fakecompact",
        {
          session: {} as any,
          appendUserMessage: () => {},
          appendSystemMessage: () => {},
          resetSession: () => {},
        },
      );

      expect(result.handled).toBe(true);
      expect(result.compact).toBe(true);
      expect(result.textResult).toBe("Compacted");
    } finally {
      BUILTIN_COMMANDS.pop();
    }
  });

  it("executeCommand 应执行内置 compact 命令并传递 custom instructions", async () => {
    let compactOptions: any;
    const result = await executeCommand(
      "/compact 只关注代码修改",
      {
        session: {
          compact: async (options: any) => {
            compactOptions = options;
            return { displayText: "Compacted conversation" };
          },
        } as any,
        appendUserMessage: () => {},
        appendSystemMessage: () => {},
        resetSession: () => {},
      },
    );

    expect(result.handled).toBe(true);
    expect(result.compact).toBe(true);
    expect(result.textResult).toBe("Compacted conversation");
    expect(compactOptions).toEqual({
      commandText: "/compact 只关注代码修改",
      instructions: "只关注代码修改",
    });
  });
});
