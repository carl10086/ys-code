// src/commands/debug/debug.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalCommandCall } from "../../commands/types.js";
import type { AgentContext, AgentLoopConfig } from "../../agent/types.js";
import { getUserContext, getUserContextAttachments } from "../../agent/context/user-context.js";
import { normalizeMessages } from "../../agent/attachments/normalize.js";
import { injectSkillListingAttachments } from "../../agent/attachments/skill-listing.js";
import { injectAtMentionAttachments } from "../../agent/stream-assistant.js";

/**
 * 将 AgentMessage[] 转换为最终发送给 LLM 的 Message[]
 * 复用 stream-assistant.ts 的转换逻辑
 */
async function transformMessagesForDebug(
  context: AgentContext,
  config: Pick<AgentLoopConfig, "convertToLlm" | "disableUserContext" | "transformContext">,
  signal?: AbortSignal,
) {
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

export const call: LocalCommandCall = async (_args, context) => {
  const { session } = context;

  // 复用转换逻辑获取真实 LLM 消息
  const llmMessages = await transformMessagesForDebug(
    {
      messages: session.messages,
      tools: session.tools,
      sentSkillNames: session.sentSkillNames,
    },
    {
      convertToLlm: session.convertToLlm,
      disableUserContext: false,
    },
  );

  const debugData = {
    sessionId: session.sessionId,
    model: session.model.name,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
    systemPrompt: session.getSystemPrompt(),
    // 导出真实 LLM 消息
    llmMessages,
    // 同时保留原始 session.messages 便于对比
    rawMessages: session.messages,
  };

  const filePath = join(process.cwd(), "debug-context.json");

  try {
    writeFileSync(filePath, JSON.stringify(debugData, null, 2), "utf-8");
    return { type: "text", value: `已导出上下文到 ${filePath}` };
  } catch (error) {
    return { type: "text", value: `导出失败: ${error instanceof Error ? error.message : String(error)}` };
  }
};
