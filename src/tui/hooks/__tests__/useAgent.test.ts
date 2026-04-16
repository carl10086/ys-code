import { describe, it, expect } from "bun:test";
import { useAgent } from "../useAgent.js";
import { Agent } from "../../../agent/agent.js";

describe("useAgent", () => {
  it("should be a function", () => {
    expect(typeof useAgent).toBe("function");
  });
});
