import type { AssistantMessage } from "../../core/ai/index.js";
import type { AgentMessage } from "../types.js";

export interface ExtractResultOptions {
  /** 提取模式 */
  mode?: "lastText" | "allAssistantText" | "smart";
}

export interface ExtractedResult {
  /** 提取的文本 */
  text: string;
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant";
}

function isTextContent(c: unknown): c is { type: "text"; text: string } {
  return typeof c === "object" && c !== null && "type" in c && (c as any).type === "text";
}

function extractTextFromMessage(message: AssistantMessage): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("");
}

const EFFECTIVE_CHAR_PATTERN = /[\s\p{P}]/gu;

function countEffectiveChars(text: string): number {
  return text.replace(EFFECTIVE_CHAR_PATTERN, "").length;
}

const DEFAULT_EFFECTIVE_CHAR_THRESHOLD = 20;

/**
 * 从子代理的消息历史中提取结果文本。
 *
 * 支持三种模式：
 * - smart（默认）：优先取最后一条有实质内容的 assistant，内容过短时回溯
 * - lastText：取最后一条 assistant 的文本
 * - allAssistantText：合并所有 assistant 文本
 */
export function extractSubagentResult(
  messages: AgentMessage[],
  options: ExtractResultOptions = {},
): ExtractedResult {
  const mode = options.mode ?? "smart";

  const assistantMessages = messages.filter(isAssistantMessage);

  if (assistantMessages.length === 0) {
    return { text: "", hasToolCalls: false, sourceMessageCount: 0 };
  }

  switch (mode) {
    case "lastText": {
      const last = assistantMessages[assistantMessages.length - 1];
      return { text: extractTextFromMessage(last) };
    }

    case "allAssistantText": {
      const texts = assistantMessages.map(extractTextFromMessage).filter((t) => t.length > 0);
      return { text: texts.join("\n\n") };
    }

    case "smart": {
      // 从后向前扫描，找到第一条有效字符数 >= 阈值的消息
      for (let i = assistantMessages.length - 1; i >= 0; i--) {
        const text = extractTextFromMessage(assistantMessages[i]);
        if (countEffectiveChars(text) >= DEFAULT_EFFECTIVE_CHAR_THRESHOLD) {
          return { text };
        }
      }
      // 兜底：返回所有 assistant 文本的合并
      const texts = assistantMessages.map(extractTextFromMessage).filter((t) => t.length > 0);
      return { text: texts.join("\n\n") };
    }

    default:
      return { text: "" };
  }
}
