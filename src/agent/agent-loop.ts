// src/agent/agent-loop.ts
import { type ToolResultMessage } from "../core/ai/index.js";
import { streamAssistantResponse, type AgentEventSink } from "./stream-assistant.js";
import { executeToolCalls } from "./tool-execution.js";
import { logger } from "../utils/logger.js";
import type {
  AgentInput,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  InvokedSkillRecord,
  StreamFn,
} from "./types.js";

/** Escalate 时的 max output tokens 上限 */
const ESCALATED_MAX_OUTPUT_TOKENS = 64000;
/** Recovery 最大重试次数 */
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;
/** Recovery 时注入的 meta message 内容 */
const RECOVERY_MESSAGE_CONTENT =
  "Output token limit hit. Resume directly — no apology, no recap of what you were doing. " +
  "Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.";

interface LoopState {
  messages: AgentMessage[];
  tools: AgentTool<any, any>[] | undefined;
  sentSkillNames?: Set<string> | undefined;
  invokedSkills?: Map<string, InvokedSkillRecord> | undefined;
  pendingToolNewMessages: AgentMessage[];
  pendingSteering: AgentMessage[];
  turnCount: number;
  /** max_output_tokens override（escalate 时使用） */
  maxOutputTokensOverride?: number;
  /** 已尝试 recovery 次数 */
  maxOutputTokensRecoveryCount: number;
}

function isValidNewMessage(message: unknown): message is AgentMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const m = message as Record<string, unknown>;
  // 只允许 user 角色的消息被注入，禁止 system/assistant/tool 伪装
  if (m.role !== "user") {
    return false;
  }
  if (!Array.isArray(m.content)) {
    return false;
  }
  if (typeof m.timestamp !== "number") {
    return false;
  }
  return true;
}

function validateNewMessages(messages: unknown[]): AgentMessage[] {
  const valid: AgentMessage[] = [];
  for (const message of messages) {
    if (isValidNewMessage(message)) {
      valid.push(message);
    } else {
      logger.warn("Invalid newMessages entry rejected", { message });
    }
  }
  return valid;
}

/** 从 LoopState 构建 AgentRuntime（供 stream/execute 使用） */
function buildRuntime(state: LoopState, messages: AgentMessage[]): AgentRuntime {
  return {
    messages,
    tools: state.tools,
    sentSkillNames: state.sentSkillNames,
    invokedSkills: state.invokedSkills,
  };
}

/** 处理 stopReason === "length" 的恢复逻辑
 * 返回 { shouldContinue: true } 表示 loop 应继续（escalate/recovery）
 * 返回 { shouldContinue: false } 表示 recovery 耗尽，loop 已终止
 */
async function handleLengthRecovery(
  state: LoopState,
  messages: AgentMessage[],
  emit: AgentEventSink,
): Promise<{ state: LoopState; shouldContinue: boolean }> {
  // Phase 1: Escalate — 仅首次 hit limit 时同请求提升上限重发
  if (state.maxOutputTokensOverride === undefined && state.maxOutputTokensRecoveryCount === 0) {
    return {
      state: { ...state, maxOutputTokensOverride: ESCALATED_MAX_OUTPUT_TOKENS },
      shouldContinue: true,
    };
  }

  // Phase 2: Recovery — 注入续写指令
  if (state.maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
    const recoveryMessage: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: RECOVERY_MESSAGE_CONTENT }],
      timestamp: Date.now(),
      isMeta: true,
    };
    // 发射 recovery message 事件（isMeta=true 使 UI 隐藏，但 LLM 可见）
    await emit({ type: "message_start", message: recoveryMessage });
    await emit({ type: "message_end", message: recoveryMessage });
    return {
      state: {
        ...state,
        messages: [...messages, recoveryMessage],
        maxOutputTokensOverride: undefined,
        maxOutputTokensRecoveryCount: state.maxOutputTokensRecoveryCount + 1,
        pendingToolNewMessages: [],
        pendingSteering: [],
      },
      shouldContinue: true,
    };
  }

  // Phase 3: Recovery 耗尽 — 优雅终止
  logger.warn("max_output_tokens recovery exhausted", { recoveryCount: state.maxOutputTokensRecoveryCount });
  await emit({ type: "agent_end" });
  return { state, shouldContinue: false };
}

async function runLoop(
  initialState: LoopState,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let state: LoopState = initialState;

  while (true) {
    // 1. 从 state 读取当前值
    let { messages, tools, pendingToolNewMessages, pendingSteering, turnCount } = state;

    // 2. 组合上一轮末尾 drain 的 steering + 工具返回的 newMessages
    const toInject = [...pendingSteering, ...pendingToolNewMessages];
    pendingToolNewMessages = [];
    pendingSteering = [];

    // 3. turn_start 事件（首次迭代已预先发射，跳过）
    if (turnCount > 0) {
      await emit({ type: "turn_start" });
    }

    // 4. 注入消息并发射事件
    for (const message of toInject) {
      await emit({ type: "message_start", message });
      await emit({ type: "message_end", message });
      messages.push(message);
    }

    // 5. 请求 assistant 回复（核心工作）
    // streamAssistantResponse 不再修改 messages，由 loop 显式控制状态更新
    const assistantMessage = await streamAssistantResponse(
      buildRuntime(state, messages),
      config,
      signal,
      emit,
      streamFn,
      state.maxOutputTokensOverride,
    );
    messages.push(assistantMessage);

    // 6. 工具执行
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
    let toolResults: ToolResultMessage[] = [];
    if (toolCalls.length > 0) {
      const execution = await executeToolCalls(
        buildRuntime(state, messages),
        assistantMessage,
        config,
        signal,
        emit,
      );
      toolResults = execution.toolResults;
      pendingToolNewMessages = validateNewMessages(execution.newMessages || []);
      for (const result of toolResults) {
        messages.push(result);
      }
    }

    // 7. 发射 turn_end（必须在 error/aborted 检查之前）
    await emit({ type: "turn_end", message: assistantMessage, toolResults });

    // 8. 错误/中止检查
    if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
      await emit({ type: "agent_end" });
      return;
    }

    // 8b. max_output_tokens 恢复检测
    if (assistantMessage.stopReason === "length") {
      const result = await handleLengthRecovery(state, messages, emit);
      if (result.shouldContinue) {
        state = result.state;
        continue;
      }
      return;
    }

    // 9. 末尾 drain steering：本轮期间用户触发的 steering 在下一轮注入
    const nextSteering = await config.getSteeringMessages?.() || [];

    // 10. 结束判断：是否需要继续下一轮
    const shouldContinue = toolCalls.length > 0
      || pendingToolNewMessages.length > 0
      || nextSteering.length > 0;

    if (!shouldContinue) {
      await emit({ type: "agent_end" });
      return;
    }

    // 11. 构建下一轮 state
    state = {
      messages,
      tools,
      pendingToolNewMessages,
      pendingSteering: nextSteering,
      turnCount: turnCount + 1,
      maxOutputTokensOverride: state.maxOutputTokensOverride,
      maxOutputTokensRecoveryCount: state.maxOutputTokensRecoveryCount,
    };
  }
}

/**
 * 启动全新的 agent 循环。
 *
 * 先发射 agent_start、turn_start 以及所有 prompt 的 message_start/end 事件，
 * 然后进入核心循环直到结束。
 */
export async function runAgentLoop(
  messages: AgentMessage[],
  prompts: AgentMessage[],
  input: AgentInput,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<void> {
  const initialState: LoopState = {
    messages: [...messages, ...prompts],
    tools: input.tools ?? [],
    sentSkillNames: input.sentSkillNames,
    invokedSkills: input.invokedSkills,
    pendingToolNewMessages: [],
    pendingSteering: [],
    turnCount: 0,
    maxOutputTokensRecoveryCount: 0,
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(initialState, config, signal, emit, streamFn);
}

/**
 * 从已有上下文继续 agent 循环。
 *
 * 要求上下文中最后一条消息不能是 assistant，且消息列表不能为空。
 */
export async function runAgentLoopContinue(
  messages: AgentMessage[],
  input: AgentInput,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<void> {
  if (messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (messages[messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const initialState: LoopState = {
    messages: [...messages],
    tools: input.tools ?? [],
    sentSkillNames: input.sentSkillNames,
    invokedSkills: input.invokedSkills,
    pendingToolNewMessages: [],
    pendingSteering: [],
    turnCount: 0,
    maxOutputTokensRecoveryCount: 0,
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  await runLoop(initialState, config, signal, emit, streamFn);
}
