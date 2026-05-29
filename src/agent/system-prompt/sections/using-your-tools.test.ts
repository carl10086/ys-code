import { describe, it, expect } from "bun:test";
import type { AgentTool } from "../../types.js";
import { compute } from "./using-your-tools.js";

describe("using-your-tools section", () => {
  it("should return empty when no tools", async () => {
    const result = await compute({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toBe("");
  });

  it("should contain tool names when tools exist", async () => {
    const mockTool: AgentTool<any, any> = {
      name: "Read",
      label: "Read",
      description: "Read files",
      parameters: {} as any,
      outputSchema: {} as any,
      execute: async () => ({}) as any,
    };
    const result = await compute({ cwd: "/tmp", tools: [mockTool], model: { id: "m1" } as any });
    expect(result).toContain("Using your tools");
    expect(result).toContain("parallel");
  });
});
