import { describe, it, expect } from "bun:test";
import { Agent } from "../agent.js";
import { createSubagent } from "./create-subagent.js";
import type { AgentTool } from "../types.js";

function createMockTool(name: string): AgentTool<any, any> {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as any,
    outputSchema: {} as any,
    execute: async () => ({}) as any,
  };
}

describe("createSubagent options", () => {
  it("allowedToolNames 过滤工具列表", () => {
    const parent = new Agent();
    parent.registerTool(createMockTool("Read"));
    parent.registerTool(createMockTool("Write"));
    parent.registerTool(createMockTool("Grep"));

    const child = createSubagent(parent, {
      allowedToolNames: ["Read", "Grep"],
    });

    const childToolNames = child.state.tools.map((t) => t.name);
    expect(childToolNames).toContain("Read");
    expect(childToolNames).toContain("Grep");
    expect(childToolNames).not.toContain("Write");
  });

  it("allowedToolNames 包含 Agent 时仍被过滤", () => {
    const parent = new Agent();
    parent.registerTool(createMockTool("Read"));

    const child = createSubagent(parent, {
      allowedToolNames: ["Read", "Agent"],
    });

    const childToolNames = child.state.tools.map((t) => t.name);
    expect(childToolNames).toContain("Read");
    expect(childToolNames).not.toContain("Agent");
  });

  it("systemPrompt 覆盖父代理系统提示", async () => {
    const customPrompt = async () => [{ type: "text", text: "custom" }] as any;
    const parent = new Agent({ systemPrompt: async () => [] as any });

    const child = createSubagent(parent, {
      systemPrompt: customPrompt as any,
    });

    expect(child.systemPrompt).toBe(customPrompt);
  });

  it("不传 options 时行为与之前一致", () => {
    const parent = new Agent();
    parent.registerTool(createMockTool("Read"));
    parent.registerTool(createMockTool("Write"));

    const child = createSubagent(parent);

    const childToolNames = child.state.tools.map((t) => t.name);
    expect(childToolNames).toContain("Read");
    expect(childToolNames).toContain("Write");
  });
});
