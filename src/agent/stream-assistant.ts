// src/agent/stream-assistant.ts
import {
  type AssistantMessage,
  type Context,
  streamSimple,
  type AssistantMessageEvent,
  type Tool,
} from "../core/ai/index.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  StreamFn,
} from "./types.js";
import { getUserContext, prependUserContext } from "./context/user-context.js";
import type { Message } from "../core/ai/index.js";

/** 事件发射器类型 */
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * 统一处理流结束后的消息替换、追加和事件发射
 */
async function finalizeStreamMessage(
  context: AgentContext,
  finalMessage: AssistantMessage,
  addedPartial: boolean,
  emit: AgentEventSink,
): Promise<void> {
  if (addedPartial) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: "message_start", message: { ...finalMessage } });
  }
  await emit({ type: "message_end", message: finalMessage });
}

/**
 * 流式获取 assistant 响应
 * @param context Agent 上下文
 * @param config AgentLoop 配置
 * @param signal 可选的 abort 信号
 * @param emit 事件发射器
 * @param streamFn 可选的流函数
 * @returns AssistantMessage 最终消息
 */
export async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  } else if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    messages = prependUserContext(messages as Message[], userContext) as typeof messages;
  }

  const llmMessages = await config.convertToLlm(messages);

  const llmContext: Context = {
    systemPrompt: config.systemPrompt,
    messages: llmMessages,
    tools: (context.tools ?? []) as Tool[],
  };

  const streamFunction = streamFn || streamSimple;

  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

  const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
  });

  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;

  for await (const event of response) {
    switch (event.type) {
      case "start": {
        // 消息开始，创建 partial message
        partialMessage = event.partial;
        context.messages.push(partialMessage);
        addedPartial = true;
        await emit({ type: "message_start", message: { ...partialMessage } });
        break;
      }

      case "text_start":   // 文本块开始
      case "text_delta":   // 文本增量
      case "text_end":     // 文本块结束
      case "thinking_start":   // 思考开始
      case "thinking_delta":   // 思考增量
      case "thinking_end":     // 思考结束
      case "toolcall_start":   // 工具调用开始
      case "toolcall_delta":   // 工具调用增量
      case "toolcall_end":     // 工具调用结束
        if (partialMessage) {
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: "message_update",
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

      case "done":   // 流式响应完成
      case "error": {   // 流式响应错误
        const finalMessage = await response.result();
        await finalizeStreamMessage(context, finalMessage, addedPartial, emit);
        return finalMessage;
      }
    }
  }

  const finalMessage = await response.result();
  await finalizeStreamMessage(context, finalMessage, addedPartial, emit);
  return finalMessage;
}
