import { describe, it, expect } from "bun:test";
import { compute } from "./doing-tasks.js";

const dummyCtx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };

describe("doing-tasks section", () => {
  it("should contain help reference", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("/help");
  });

  it("should contain feedback guidance", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("feedback");
  });
});
