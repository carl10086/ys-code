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
  AgentMessage,
} from "./types.js";
import { getUserContext, getUserContextAttachments } from "./context/user-context.js";
import { normalizeMessages } from "./attachments/normalize.js";
import { extractAtMentionedFiles, readAtMentionedFile } from "./attachments/at-mention.js";
import { injectSkillListingAttachments } from "./attachments/skill-listing.js";
import type { Message } from "../core/ai/index.js";
import type { AttachmentMessage } from "./attachments/types.js";
import { logger } from "../utils/logger.js";

/** 事件发射器类型 */
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * 将 AgentMessage[] 转换为最终发送给 LLM 的 Message[]
 * 包含：userContext attachments、skill listing、@mention attachments、normalize
 */
async function transformMessages(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): Promise<Message[]> {
  let messages = context.messages;

  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  } else if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    const attachments = getUserContextAttachments(userContext);
    messages = [...attachments, ...messages];
  }

  const sentSkillNames = context.sentSkillNames ?? new Set<string>();
  messages = await injectSkillListingAttachments(messages, process.cwd(), sentSkillNames);
  messages = await injectAtMentionAttachments(messages, process.cwd());

  const normalizedMessages = normalizeMessages(messages);
  return config.convertToLlm(normalizedMessages);
}

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
 * 扫描 user message 中的 @... 引用，注入对应的 attachment 消息
 * @param messages 原始 AgentMessage 数组
 * @param cwd 当前工作目录（用于解析相对路径）
 * @returns 注入 attachment 后的新数组
 */
export async function injectAtMentionAttachments(
  messages: AgentMessage[],
  cwd: string,
): Promise<AgentMessage[]> {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    result.push(msg);

    if (msg.role !== "user" || typeof msg.content !== "string") {
      continue;
    }

    const mentionedFiles = extractAtMentionedFiles(msg.content);
    if (mentionedFiles.length === 0) {
      continue;
    }

    const attachments = await Promise.all(
      mentionedFiles.map((fp) => readAtMentionedFile(fp, cwd)),
    );

    for (const attachment of attachments) {
      if (attachment) {
        result.push({
          role: "attachment",
          attachment,
          timestamp: Date.now(),
        } as AgentMessage);
      }
    }
  }

  return result;
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
  const llmMessages = await transformMessages(context, config, signal);

  const llmContext: Context = {
    systemPrompt: config.systemPrompt,
    messages: llmMessages,
    tools: (context.tools ?? []) as Tool[],
  };

  const streamFunction = streamFn || streamSimple;

  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

  logger.debug("Stream request started", { model: config.model.name });

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
        logger.debug("Stream started");
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
        if (partialMessage) {
          if (event.type === "text_delta") {
            logger.debug("Text delta", { delta: event.delta });
          }
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: "message_update",
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

      case "thinking_start":   // 思考开始
      case "thinking_delta":   // 思考增量
      case "thinking_end":     // 思考结束
        if (partialMessage) {
          if (event.type === "thinking_delta") {
            logger.debug("Thinking delta", { delta: event.delta });
          }
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: "message_update",
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

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

      case "done": {  // 流式响应完成
        logger.debug("Stream done", { stopReason: partialMessage?.stopReason });
        const finalMessageDone = await response.result();
        await finalizeStreamMessage(context, finalMessageDone, addedPartial, emit);
        return finalMessageDone;
      }

      case "error": {   // 流式响应错误
        logger.debug("Stream error");
        const finalMessageError = await response.result();
        await finalizeStreamMessage(context, finalMessageError, addedPartial, emit);
        return finalMessageError;
      }
    }
  }

  const finalMessage = await response.result();
  await finalizeStreamMessage(context, finalMessage, addedPartial, emit);
  return finalMessage;
}
