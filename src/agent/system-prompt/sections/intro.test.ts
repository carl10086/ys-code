import { describe, it, expect } from "bun:test";
import { compute } from "./intro.js";

const dummyCtx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };

describe("intro section", () => {
  it("should contain agent identity", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("interactive agent");
    expect(result).toContain("software engineering tasks");
  });

  it("should contain CYBER_RISK_INSTRUCTION", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("Assist with authorized security testing");
    expect(result).toContain("Refuse requests for destructive techniques");
  });

  it("should contain URL rules", async () => {
    const result = await compute(dummyCtx);
    expect(result).toContain("NEVER generate or guess URLs");
  });
});
