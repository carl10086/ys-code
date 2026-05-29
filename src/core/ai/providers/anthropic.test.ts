import { describe, it, expect } from "bun:test";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../../../agent/system-prompt/types.js";
import { buildSystemBlocks } from "./anthropic.js";

const cacheControl = { type: "ephemeral" as const, ttl: "1h" as const };

describe("buildSystemBlocks", () => {
  it("splits static and dynamic sections at boundary", () => {
    const sections = [
      "static content",
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      "dynamic content",
    ];
    const blocks = buildSystemBlocks(sections, cacheControl);
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toContain("static content");
    expect(blocks[1].text).toContain("dynamic content");
  });

  it("adds cache_control to static sections only", () => {
    const sections = [
      "static content",
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      "dynamic content",
    ];
    const blocks = buildSystemBlocks(sections, cacheControl);
    expect(blocks[0]).toHaveProperty("cache_control", cacheControl);
    expect(blocks[1]).not.toHaveProperty("cache_control");
  });

  it("treats all sections as static when no boundary", () => {
    const sections = ["content 1", "content 2"];
    const blocks = buildSystemBlocks(sections, cacheControl);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toHaveProperty("cache_control", cacheControl);
    expect(blocks[0].text).toContain("content 1");
  });

  it("returns empty array for empty sections", () => {
    const blocks = buildSystemBlocks([], cacheControl);
    expect(blocks.length).toBe(0);
  });
});
