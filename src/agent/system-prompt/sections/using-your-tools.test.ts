import { describe, it, expect } from "bun:test";
import type { AgentTool } from "../../types.js";
import { compute } from "./using-your-tools.js";

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

describe("using-your-tools section", () => {
  it("should return empty when no tools", async () => {
    const result = await compute({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toBe("");
  });

  it("should contain tool names when tools exist", async () => {
    const result = await compute({ cwd: "/tmp", tools: [createMockTool("Read")], model: { id: "m1" } as any });
    expect(result).toContain("Using your tools");
    expect(result).toContain("parallel");
  });

  it("should contain TodoWrite guidance when TodoWrite is available", async () => {
    const result = await compute({ cwd: "/tmp", tools: [createMockTool("TodoWrite")], model: { id: "m1" } as any });
    expect(result).toContain("Break down and manage your work with the TodoWrite tool");
  });

  it("should NOT contain TodoWrite guidance when TodoWrite is NOT available", async () => {
    const result = await compute({ cwd: "/tmp", tools: [createMockTool("Read")], model: { id: "m1" } as any });
    expect(result).not.toContain("TodoWrite");
  });
});
