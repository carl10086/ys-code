// src/agent/system-prompt/systemPrompt.test.ts
import { describe, it, expect } from "bun:test";
import { createSystemPromptBuilder, type SystemPromptSection } from "./systemPrompt.js";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./types.js";
import { asSystemPrompt } from "../../core/ai/types.js";

describe("createSystemPromptBuilder", () => {
  it("should return sections with boundary between static and dynamic", async () => {
    const sections: SystemPromptSection[] = [
      { name: "s1", compute: async () => "static1", getCacheKey: () => "k1" },
      { name: "d1", compute: async () => "dynamic1" },
    ];
    const builder = createSystemPromptBuilder(sections);
    const result = await builder({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
    expect(result).toEqual(asSystemPrompt(["static1", SYSTEM_PROMPT_DYNAMIC_BOUNDARY, "dynamic1"]));
  });

  it("should cache static sections", async () => {
    let callCount = 0;
    const sections: SystemPromptSection[] = [
      {
        name: "s1",
        compute: async () => {
          callCount++;
          return "v1";
        },
        getCacheKey: () => "k1",
      },
    ];
    const builder = createSystemPromptBuilder(sections);
    const ctx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };
    await builder(ctx);
    await builder(ctx);
    expect(callCount).toBe(1);
  });

  it("should recompute dynamic sections every time", async () => {
    let callCount = 0;
    const sections: SystemPromptSection[] = [
      {
        name: "d1",
        compute: async () => {
          callCount++;
          return "v1";
        },
      },
    ];
    const builder = createSystemPromptBuilder(sections);
    const ctx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };
    await builder(ctx);
    await builder(ctx);
    expect(callCount).toBe(2);
  });

  it("should return empty string when section compute throws", async () => {
    const sections: SystemPromptSection[] = [
      { name: "bad", compute: async () => { throw new Error("fail"); }, getCacheKey: () => "k1" },
    ];
    const builder = createSystemPromptBuilder(sections);
    const ctx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };
    const result = await builder(ctx);
    expect(result).toEqual(asSystemPrompt([""]));
  });
});
