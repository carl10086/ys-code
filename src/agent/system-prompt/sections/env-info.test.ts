import { describe, it, expect } from "bun:test";
import { compute } from "./env-info.js";

describe("env-info section", () => {
  it("should contain working directory", async () => {
    const result = await compute({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toContain("working directory");
    expect(result).toContain("/tmp");
  });

  it("should contain model info", async () => {
    const result = await compute({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toContain("model");
    expect(result).toContain("m1");
  });

  it("should contain git status", async () => {
    const result = await compute({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toContain("git");
  });

  it("should contain platform info", async () => {
    const result = await compute({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toContain("Platform");
  });
});
