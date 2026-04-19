// src/agent/agent-loop.ts
import { type AssistantMessage, type ToolResultMessage } from "../core/ai/index.js";
import { streamAssistantResponse, type AgentEventSink } from "./stream-assistant.js";
import { executeToolCalls } from "./tool-execution.js";
import { logger } from "../utils/logger.js";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  StreamFn,
} from "./types.js";

/**
 * 执行单次 turn：注入 pendingMessages、请求 assistant 回复、执行工具调用并发射 turn_end。
 *
 * @param currentContext - 当前 agent 上下文
 * @param newMessages - 本轮 agent 产生的新消息集合
 * @param pendingMessages - 待注入的 steering / follow-up 消息数组（会被清空）
 * @param config - agent 循环配置
 * @param signal - 可选的取消信号
 * @param emit - 事件发射器
 * @param streamFn - 可选的流式请求函数
 * @returns assistant 消息与工具执行结果
 */
async function runTurnOnce(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  pendingMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<{ assistantMessage: AssistantMessage; toolResults: ToolResultMessage[] }> {
  logger.debug("runTurnOnce started");

  if (pendingMessages.length > 0) {
    for (const message of pendingMessages) {
      logger.debug("Injecting pending message", { role: message.role });
      await emit({ type: "message_start", message });
      await emit({ type: "message_end", message });
      currentContext.messages.push(message);
      newMessages.push(message);
    }
    pendingMessages.length = 0;
  }

  const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
  newMessages.push(message);

  const toolCalls = message.content.filter((c) => c.type === "toolCall");
  const hasMoreToolCalls = toolCalls.length > 0;

  const toolResults: ToolResultMessage[] = [];
  if (hasMoreToolCalls) {
    toolResults.push(...(await executeToolCalls(currentContext, message, config, signal, emit)));

    for (const result of toolResults) {
      currentContext.messages.push(result);
      newMessages.push(result);
    }
  }

  await emit({ type: "turn_end", message, toolResults });

  return { assistantMessage: message, toolResults };
}

/**
 * 核心循环逻辑：反复执行 turn，直到没有更多工具调用、steering 消息或 follow-up 消息为止。
 *
 * @param currentContext - 当前 agent 上下文
 * @param newMessages - 本轮 agent 产生的新消息集合
 * @param config - agent 循环配置
 * @param signal - 可选的取消信号
 * @param emit - 事件发射器
 * @param streamFn - 可选的流式请求函数
 */
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let hasPreEmittedTurnStart = true;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  while (true) {
    let hasMoreToolCalls = true;

    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!hasPreEmittedTurnStart) {
        await emit({ type: "turn_start" });
      }
      hasPreEmittedTurnStart = false;

      const { assistantMessage: message, toolResults } = await runTurnOnce(
        currentContext,
        newMessages,
        pendingMessages,
        config,
        signal,
        emit,
        streamFn,
      );

      logger.debug("Loop condition check", {
        hasMoreToolCalls: message.content.filter((c) => c.type === "toolCall").length > 0,
        pendingMessages: pendingMessages.length,
        stopReason: message.stopReason,
      });

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      hasMoreToolCalls = message.content.filter((c) => c.type === "toolCall").length > 0;
      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      hasPreEmittedTurnStart = false;
      continue;
    }

    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}

/**
 * 启动全新的 agent 循环。
 *
 * 先发射 agent_start、turn_start 以及所有 prompt 的 message_start/end 事件，
 * 然后进入核心循环直到结束。
 *
 * @param prompts - 用户初始 prompt 消息
 * @param context - 初始 agent 上下文
 * @param config - agent 循环配置
 * @param emit - 事件发射器
 * @param signal - 可选的取消信号
 * @param streamFn - 可选的流式请求函数
 * @returns 本轮产生的新消息数组（包含 prompts 和 assistant 回复）
 */
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

/**
 * 从已有上下文继续 agent 循环。
 *
 * 要求上下文中最后一条消息不能是 assistant，且消息列表不能为空。
 *
 * @param context - 当前 agent 上下文
 * @param config - agent 循环配置
 * @param emit - 事件发射器
 * @param signal - 可选的取消信号
 * @param streamFn - 可选的流式请求函数
 * @returns 本轮产生的新消息数组
 */
export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages[context.messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = { ...context };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}
