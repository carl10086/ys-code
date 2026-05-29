import { describe, it, expect } from "bun:test";
import { compute } from "./system.js";

const dummyCtx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };

describe("system section", () => {
  it("should contain hooks guidance", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("hooks");
    expect(result).toContain("user-prompt-submit-hook");
  });

  it("should contain system-reminder guidance", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("<system-reminder>");
  });

  it("should contain automatic compression note", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("compress");
  });
});
