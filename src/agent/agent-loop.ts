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

interface LoopState {
  messages: AgentMessage[];
  tools: AgentTool<any, any>[] | undefined;
  sentSkillNames?: Set<string> | undefined;
  invokedSkills?: Map<string, InvokedSkillRecord> | undefined;
  pendingToolNewMessages: AgentMessage[];
  pendingSteering: AgentMessage[];
  turnCount: number;
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
      { messages, tools, sentSkillNames: state.sentSkillNames, invokedSkills: state.invokedSkills },
      config,
      signal,
      emit,
      streamFn,
    );
    messages.push(assistantMessage);

    // 6. 工具执行
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
    let toolResults: ToolResultMessage[] = [];
    if (toolCalls.length > 0) {
      const execution = await executeToolCalls(
        { messages, tools, sentSkillNames: state.sentSkillNames, invokedSkills: state.invokedSkills },
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
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  await runLoop(initialState, config, signal, emit, streamFn);
}
