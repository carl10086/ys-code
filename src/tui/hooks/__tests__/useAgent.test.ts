import { describe, it, expect } from "bun:test";
import { useAgent } from "../useAgent.js";

describe("useAgent", () => {
  it("should be a function", () => {
    expect(typeof useAgent).toBe("function");
  });
});
