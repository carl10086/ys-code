// src/agent/stream-assistant.ts
import {
  type AssistantMessage,
  type Context,
  streamSimple,
  type Tool,
} from "../core/ai/index.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  StreamFn,
  AgentMessage,
} from "./types.js";
import { getUserContext, prependUserContext } from "./context/user-context.js";
import { normalizeMessages } from "./attachments/normalize.js";
import { extractAtMentionedFiles, readAtMentionedFile } from "./attachments/at-mention.js";
import type { Message } from "../core/ai/index.js";
import { logger } from "../utils/logger.js";
import { join } from "node:path";
import { getCommands } from "../commands/index.js";
import { formatSkillListing } from "./attachments/skill-listing.js";
import type { PromptCommand } from "../commands/types.js";

/** 事件发射器类型 */
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * 阶段 1: 生成 Attachment Messages
 * 生成但不保存，返回需要被添加的 attachment 列表
 */
async function generateAttachments(
  context: AgentContext,
  _config: AgentLoopConfig,
  _signal?: AbortSignal,
): Promise<AgentMessage[]> {
  const attachments: AgentMessage[] = [];

  // skill listing attachments
  const sentSkillNames = context.sentSkillNames ?? new Set<string>();
  const skillCommands = await getCommands(join(process.cwd(), ".claude/skills"));
  const newSkills = skillCommands.filter(
    (cmd): cmd is PromptCommand => cmd.type === "prompt" && !sentSkillNames.has(cmd.name)
  );
  if (newSkills.length > 0) {
    const content = formatSkillListing(newSkills);
    attachments.push({
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content,
        skillNames: newSkills.map(s => s.name),
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    } as AgentMessage);
  }

  // @mention attachments
  const mentionPromises: Promise<void>[] = [];
  for (const msg of context.messages) {
    if (msg.role !== "user" || typeof msg.content !== "string") continue;
    const mentionedFiles = extractAtMentionedFiles(msg.content);
    for (const fp of mentionedFiles) {
      mentionPromises.push(
        readAtMentionedFile(fp, process.cwd()).then((attachment) => {
          if (attachment) {
            attachments.push({ role: "attachment", attachment, timestamp: Date.now() } as AgentMessage);
          }
        }),
      );
    }
  }
  await Promise.all(mentionPromises);

  return attachments;
}

/**
 * 阶段 2: 保存 Attachments 到 Agent State
 * 通过事件机制将 attachment 持久化
 */
async function saveAttachments(
  attachments: AgentMessage[],
  emit: AgentEventSink,
): Promise<void> {
  for (const attachment of attachments) {
    await emit({ type: "message_start", message: attachment });
    await emit({ type: "message_end", message: attachment });
  }
}

/**
 * 阶段 3: 构建 API Payload
 * 纯函数，输入完整 messages（含 attachment），输出 LLM 可用格式
 */
function buildApiPayload(
  messages: AgentMessage[],
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>,
): Promise<Message[]> {
  // normalize 将 attachment → user message（<system-reminder> 包装）
  const normalized = normalizeMessages(messages);
  // convertToLlm 过滤 role（默认只保留 user/assistant/toolResult）
  return Promise.resolve(convertToLlm(normalized as AgentMessage[]));
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
  // === 阶段 1: 生成 Attachments ===
  const attachments = await generateAttachments(context, config, signal);

  // === 阶段 2: 保存 Attachments 到 State ===
  // 这会触发 message_end 事件，将 attachment 写入 agent.state.messages
  await saveAttachments(attachments, emit);

  // === 阶段 3: 构建 API Payload ===
  let allMessages = [...context.messages, ...attachments] as Message[];

  // 动态注入 userContext（不持久化）
  if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    allMessages = prependUserContext(allMessages, userContext);
  }

  const llmMessages = await buildApiPayload(allMessages as AgentMessage[], config.convertToLlm);

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

// 导出三阶段函数供测试使用
export { generateAttachments, saveAttachments, buildApiPayload };
