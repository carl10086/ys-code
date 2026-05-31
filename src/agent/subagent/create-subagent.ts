import { Agent } from "../agent.js";
import { randomUUID } from "node:crypto";

/**
 * 从父 Agent 创建隔离的子 Agent 实例。
 *
 * 子代理拥有独立的 mutable 状态（messages、fileStateCache、listeners），
 * 但复用父代理的配置（systemPrompt、tools、streamFn 等）。
 *
 * @param parentAgent 父 Agent 实例
 * @param depth 当前嵌套深度（0 表示根代理的直接子代理）
 * @returns 新建的子 Agent 实例
 */
export function createSubagent(parentAgent: Agent, depth: number): Agent {
  const parentState = parentAgent.state;

  return new Agent({
    systemPrompt: parentAgent.systemPrompt,
    convertToLlm: parentAgent.convertToLlm,
    streamFn: parentAgent.streamFn,
    getApiKey: parentAgent.getApiKey,
    onPayload: parentAgent.onPayload,
    sessionId: randomUUID(),
    transport: parentAgent.transport,
    maxRetryDelayMs: parentAgent.maxRetryDelayMs,
    toolExecution: parentAgent.toolExecution,
    initialState: {
      model: parentState.model,
      thinkingLevel: parentState.thinkingLevel,
      tools: parentState.tools.filter((t) => t.name !== "Agent"),
      messages: [],
      invokedSkills: parentState.invokedSkills,
      sentSkillNames: parentState.sentSkillNames,
    },
  });
}
