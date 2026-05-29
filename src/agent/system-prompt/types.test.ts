import { describe, it, expect } from "bun:test";
import type { CacheScope, SystemPromptBlock } from "./types.js";

describe("SystemPromptBlock types", () => {
  it("CacheScope accepts all valid values", () => {
    const globalScope: CacheScope = "global";
    const orgScope: CacheScope = "org";
    const nullScope: CacheScope = null;
    expect(globalScope).toBe("global");
    expect(orgScope).toBe("org");
    expect(nullScope).toBeNull();
  });

  it("SystemPromptBlock can be constructed", () => {
    const block: SystemPromptBlock = {
      text: "test content",
      cacheScope: "global",
    };
    expect(block.text).toBe("test content");
    expect(block.cacheScope).toBe("global");
  });
});
