import { describe, it, expect } from "bun:test";
import { createSkillTool } from "./skill.js";
import type { PromptCommand } from "../../commands/types.js";

describe("createSkillTool", () => {
  const createMockCommand = (overrides: Partial<PromptCommand> = {}): PromptCommand => ({
    type: "prompt",
    name: "test-skill",
    description: "Test skill",
    progressMessage: "running",
    contentLength: 100,
    getPromptForCommand: async (args: string) => [
      { type: "text", text: `Skill content: ${args}` },
    ],
    ...overrides,
  } as PromptCommand);

  it("成功执行 skill 并返回正确结构", async () => {
    const command = createMockCommand({
      sourcePath: "/workspace/.claude/skills/test-skill/SKILL.md",
    });
    const tool = createSkillTool(async () => [command]);

    const result = await tool.execute("call-1", { skill: "test-skill", args: "hello" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      fileStateCache: {} as any,
    });

    expect(result.details.success).toBe(true);
    expect(result.details.skillName).toBe("test-skill");
    expect(result.details.skillPath).toBe("/workspace/.claude/skills/test-skill/SKILL.md");
    expect(result.details.skillContent).toBe("Skill content: hello");
    expect(result.details.invokedAt).toBeNumber();
    expect(result.newMessages).toHaveLength(1);
    expect(result.newMessages![0].role).toBe("user");
    expect(result.newMessages![0].isMeta).toBe(true);
    expect(result.newMessages![0].content).toBe("Skill content: hello");
  });

  it("execute: command 无 sourcePath 时 skillPath fallback 为空字符串", async () => {
    const command = createMockCommand();
    const tool = createSkillTool(async () => [command]);

    const result = await tool.execute("call-1", { skill: "test-skill", args: "hello" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      fileStateCache: {} as any,
    });

    expect(result.details.success).toBe(true);
    expect(result.details.skillPath).toBe("");
    expect(result.details.skillContent).toBe("Skill content: hello");
    expect(result.details.invokedAt).toBeNumber();
  });

  it("validateInput: skill 未找到时返回错误", async () => {
    const tool = createSkillTool(async () => []);

    const result = await tool.validateInput!({ skill: "missing" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      fileStateCache: {} as any,
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("not found");
  });

  it("validateInput: userInvocable=false 的 skill 应被阻止", async () => {
    const command = createMockCommand({ userInvocable: false });
    const tool = createSkillTool(async () => [command]);

    const result = await tool.validateInput!({ skill: "test-skill" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      fileStateCache: {} as any,
    });

    expect(result.ok).toBe(false);
    expect((result as any).message).toContain("not available");
  });

  it("execute: skill 未找到时返回防御性错误", async () => {
    const tool = createSkillTool(async () => []);

    const result = await tool.execute("call-1", { skill: "missing" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      fileStateCache: {} as any,
    });

    expect(result.details.success).toBe(false);
    expect(result.details.skillName).toBe("missing");
    expect(result.newMessages).toBeUndefined();
    expect((result.content[0] as any).text).toContain("not found");
  });

  it("无参数时传递空字符串给 getPromptForCommand", async () => {
    let receivedArgs = "not-called";
    const command = createMockCommand({
      getPromptForCommand: async (args: string) => {
        receivedArgs = args;
        return [{ type: "text", text: "ok" }];
      },
    });
    const tool = createSkillTool(async () => [command]);

    await tool.execute("call-1", { skill: "test-skill" }, {
      abortSignal: new AbortController().signal,
      messages: [],
      tools: [],
      fileStateCache: {} as any,
    });

    expect(receivedArgs).toBe("");
  });

  it("formatResult 返回正确文本", () => {
    const tool = createSkillTool(async () => []);

    const formatted = tool.formatResult!(
      { details: { skillName: "my-skill" } } as any,
      "call-1",
    );

    expect(formatted).toEqual([{ type: "text", text: "Skill my-skill executed" }]);
  });
});
