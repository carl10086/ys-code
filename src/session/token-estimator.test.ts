import { describe, it, expect } from "bun:test";
import { TokenEstimator } from "./token-estimator.js";
import type { AgentMessage } from "../agent/types.js";

describe("TokenEstimator", () => {
  const estimator = new TokenEstimator();

  it("空消息应返回 0", () => {
    expect(estimator.estimate([])).toBe(0);
  });

  it("应估算文本消息 token", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world" }], timestamp: 1 },
    ];
    expect(estimator.estimate(messages)).toBeGreaterThan(0);
    expect(estimator.estimate(messages)).toBeLessThanOrEqual(11);
  });

  it("应累加多条消息", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: 2 },
    ];
    const tokens = estimator.estimate(messages);
    expect(tokens).toBeGreaterThanOrEqual(2);
  });
});
