import { randomUUID } from "node:crypto";
import type { SystemPrompt } from "../../core/ai/index.js";
import { Agent } from "../agent.js";
import type { AgentInput } from "../types.js";

const AGENT_TOOL_NAME = "Agent";

export interface CreateSubagentOptions {
  /** 允许的工具名称列表，undefined 表示继承全部 */
  allowedToolNames?: string[];
  /** 显式覆盖系统提示词构建函数 */
  systemPrompt?: (context: AgentInput) => Promise<SystemPrompt>;
}

/**
 * 从父 Agent 创建隔离的子 Agent 实例。
 *
 * 子代理拥有独立的 mutable 状态（messages、fileStateCache、listeners），
 * 但复用父代理的配置（systemPrompt、tools、streamFn 等）。
 *
 * @param parentAgent 父 Agent 实例
 * @param options 可选配置
 * @returns 新建的子 Agent 实例
 */
export function createSubagent(parentAgent: Agent, options?: CreateSubagentOptions): Agent {
  const parentState = parentAgent.state;

  const baseTools = parentState.tools.filter((t) => t.name !== AGENT_TOOL_NAME);
  const filteredTools = options?.allowedToolNames
    ? baseTools.filter((t) => options.allowedToolNames!.includes(t.name))
    : baseTools;

  return new Agent({
    systemPrompt: options?.systemPrompt ?? parentAgent.systemPrompt,
    convertToLlm: parentAgent.convertToLlm,
    streamFn: parentAgent.streamFn,
    getApiKey: parentAgent.getApiKey,
    sessionId: randomUUID(),
    transport: parentAgent.transport,
    maxRetryDelayMs: parentAgent.maxRetryDelayMs,
    toolExecution: parentAgent.toolExecution,
    initialState: {
      model: parentState.model,
      thinkingLevel: parentState.thinkingLevel,
      tools: filteredTools,
      messages: [],
      invokedSkills: parentState.invokedSkills,
      sentSkillNames: parentState.sentSkillNames,
    },
  });
}
