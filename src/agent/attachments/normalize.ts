import type { UserMessage, Message } from "../../core/ai/types.js";
import type { Attachment, AttachmentMessage } from "./types.js";
import type { AgentMessage } from "../types.js";

/** 将单个 attachment 展开为 UserMessage 数组 */
export function normalizeAttachment(attachment: Attachment): UserMessage[] {
  switch (attachment.type) {
    case "relevant_memories": {
      const content = [
        "<system-reminder>",
        "As you answer the user's questions, you can use the following context:",
        ...attachment.entries.map((e) => `# ${e.key}\n${e.value}`),
        "",
        "IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
        "</system-reminder>",
        "",
      ].join("\n");
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    case "file": {
      // attachment.content 是 FileReadToolOutput 对象
      const toolInput = JSON.stringify({ file_path: attachment.filePath });
      const toolResult = `Result of calling the FileReadTool tool:\n${JSON.stringify(attachment.content)}`;
      const content = [
        "<system-reminder>",
        `Called the FileReadTool tool with the following input: ${toolInput}`,
        "",
        toolResult,
        "</system-reminder>",
        "",
      ].join("\n");
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    case "directory": {
      const toolInput = JSON.stringify({
        command: `ls ${attachment.path}`,
        description: `Lists files in ${attachment.path}`,
      });
      const toolResult = JSON.stringify({
        stdout: attachment.content,
        stderr: "",
        interrupted: false,
      });
      const content = [
        "<system-reminder>",
        `Called the BashTool tool with the following input: ${toolInput}`,
        "",
        `Result of calling the BashTool tool:`,
        toolResult,
        "</system-reminder>",
        "",
      ].join("\n");
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    default: {
      // 穷尽检查 —— 新增类型时必须添加 case
      const _exhaustive: never = attachment;
      return [];
    }
  }
}

/** 将 AgentMessage[] 中的 attachment 展开并合并到相邻 user message */
export function normalizeMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role !== "attachment") {
      result.push(msg);
      continue;
    }

    const expanded = normalizeAttachment(msg.attachment);
    if (expanded.length === 0) continue;

    // 尝试合并到前一个 user message
    const last = result[result.length - 1];
    if (
      last &&
      last.role === "user" &&
      typeof last.content === "string"
    ) {
      const first = expanded[0];
      if (typeof first.content === "string") {
        last.content = last.content + "\n" + first.content;
        result.push(...expanded.slice(1));
        continue;
      }
    }

    // 无法合并，直接追加
    result.push(...expanded);
  }

  return result;
}
