import { describe, it, expect } from "bun:test";
import { getCommands, BUILTIN_COMMANDS } from "./index.js";

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
