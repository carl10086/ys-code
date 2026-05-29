import { describe, it, expect } from "bun:test";
import { appendSystemContext } from "./system-context.js";

describe("appendSystemContext", () => {
  it("returns original array when context is empty", () => {
    const original = ["line 1", "line 2"];
    const result = appendSystemContext(original, {});
    expect(result).toEqual(["line 1", "line 2"]);
  });

  it("appends context entries to the end", () => {
    const original = ["line 1"];
    const result = appendSystemContext(original, { cwd: "/tmp", model: "claude" });
    expect(result[0]).toBe("line 1");
    expect(result[1]).toContain("cwd: /tmp");
    expect(result[1]).toContain("model: claude");
  });

  it("filters empty context values", () => {
    const original = ["line 1"];
    const result = appendSystemContext(original, { cwd: "/tmp", empty: "" });
    expect(result[1]).toContain("cwd: /tmp");
    expect(result[1]).not.toContain("empty");
  });
});
