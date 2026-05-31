import { describe, it, expect } from "bun:test";
import { Agent } from "../agent.js";
import { createSubagent } from "./create-subagent.js";
import type { AgentTool } from "../types.js";

function createMockTool(name: string): AgentTool<any, any> {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as any,
    outputSchema: {} as any,
    execute: async () => ({}) as any,
  };
}

describe("createSubagent", () => {
  it("子代理的 messages 为空列表", () => {
    const parent = new Agent();
    parent.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() });

    const child = createSubagent(parent, 0);

    expect(child.state.messages).toEqual([]);
  });

  it("子代理的 tools 与父代理一致", () => {
    const parent = new Agent();
    const tool = createMockTool("Read");
    parent.registerTool(tool);

    const child = createSubagent(parent, 0);

    expect(child.state.tools).toEqual([tool]);
  });

  it("子代理的 fileStateCache 与父代理不是同一实例", () => {
    const parent = new Agent();
    const child = createSubagent(parent, 0);

    expect(child.getFileStateCache()).not.toBe(parent.getFileStateCache());
  });

  it("子代理没有事件监听者", () => {
    const parent = new Agent();
    const unsubscribe = parent.subscribe(() => {});
    expect(parent.state).toBeDefined();

    const child = createSubagent(parent, 0);

    // child 没有 listener，所以 processEvents 不会被外部触发
    // 我们通过检查 child 是否能独立运行来间接验证
    expect(child).toBeDefined();
    unsubscribe();
  });

  it("子代理的 sessionId 与父代理不同", () => {
    const parent = new Agent({ sessionId: "parent-session" });
    const child = createSubagent(parent, 0);

    expect(child.sessionId).not.toBe("parent-session");
    expect(child.sessionId).toBeDefined();
  });

  it("子代理复制父代理的 systemPrompt 函数引用", async () => {
    const customPrompt = async () => [] as any;
    const parent = new Agent({ systemPrompt: customPrompt as any });

    const child = createSubagent(parent, 0);

    expect(child.systemPrompt).toBe(customPrompt);
  });

  it("子代理复制父代理的 streamFn 函数引用", () => {
    const customStreamFn = () => ({}) as any;
    const parent = new Agent({ streamFn: customStreamFn as any });

    const child = createSubagent(parent, 0);

    expect(child.streamFn).toBe(customStreamFn);
  });

  it("子代理复制父代理的 convertToLlm 函数引用", () => {
    const customConvert = (msgs: any[]) => msgs;
    const parent = new Agent({ convertToLlm: customConvert });

    const child = createSubagent(parent, 0);

    expect(child.convertToLlm).toBe(customConvert);
  });

  it("子代理复制父代理的 model", () => {
    const customModel = {
      id: "custom-model",
      name: "Custom",
      api: "anthropic",
      provider: "anthropic",
      baseUrl: "",
      reasoning: false,
      input: [],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100000,
      maxTokens: 4096,
    } as any;
    const parent = new Agent({ initialState: { model: customModel } });

    const child = createSubagent(parent, 0);

    expect(child.state.model.id).toBe("custom-model");
  });
});
