import { describe, it, expect } from "bun:test";
import { compute } from "./todo-write-prompt.js";
import type { SystemPromptContext } from "../types.js";
import type { AgentTool } from "../../types.js";
import { Type } from "@sinclair/typebox";

function createMockContext(tools: AgentTool<any, any>[] = []): SystemPromptContext {
  return {
    cwd: "/test",
    tools,
    model: { id: "test", name: "test", api: "anthropic-messages", provider: "anthropic", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 0, maxTokens: 0 },
  };
}

function createMockTool(name: string, prompt?: string): AgentTool {
  return {
    name,
    description: "test",
    parameters: Type.Object({}),
    outputSchema: Type.Object({}),
    label: "test",
    execute: async () => ({}),
    prompt,
  } as AgentTool;
}

describe("todo-write-prompt section", () => {
  it("当 TodoWrite 存在且有 prompt 时输出 prompt 内容", async () => {
    const context = createMockContext([
      createMockTool("Bash"),
      createMockTool("TodoWrite", "## TodoWrite Guide\n\nUse this tool wisely."),
    ]);

    const result = await compute(context);
    expect(result).toContain("TodoWrite Guide");
    expect(result).toContain("Use this tool wisely");
  });

  it("当 TodoWrite 不存在时返回空字符串", async () => {
    const context = createMockContext([
      createMockTool("Bash"),
      createMockTool("Read"),
    ]);

    const result = await compute(context);
    expect(result).toBe("");
  });

  it("当 TodoWrite 存在但没有 prompt 时返回空字符串", async () => {
    const context = createMockContext([
      createMockTool("TodoWrite"),
    ]);

    const result = await compute(context);
    expect(result).toBe("");
  });

  it("当 tools 为空时返回空字符串", async () => {
    const context = createMockContext([]);

    const result = await compute(context);
    expect(result).toBe("");
  });
});
