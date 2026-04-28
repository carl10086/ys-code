import type { UserMessage, Message } from "../../core/ai/types.js";
import type { Attachment } from "./types.js";
import type { AgentMessage } from "../types.js";

/** 将单个 attachment 展开为 UserMessage 数组 */
export function normalizeAttachment(attachment: Attachment): UserMessage[] {
  switch (attachment.type) {
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
    case "skill_listing": {
      const content = [
        "<system-reminder>",
        "You can use the following skills:",
        "",
        attachment.content,
        "",
        "To use a skill, call the SkillTool with the skill name.",
        "</system-reminder>",
        "",
      ].join("\n");
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    default: {
      // 穷尽检查 —— 新增类型时必须添加 case
      const _exhaustive: never = attachment;
      return _exhaustive ?? [];
    }
  }
}

/**
 * 将 AgentMessage[] 中的 attachment 展开并合并到相邻 user message
 * 纯函数：不修改输入数组中的任何对象
 */
export function normalizeMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role !== "attachment") {
      // 非 attachment 直接推入，但创建浅拷贝避免修改原对象
      result.push({ ...msg });
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
        // 创建新的 user message 而不是修改原数组中的对象
        result[result.length - 1] = {
          ...last,
          content: last.content + "\n" + first.content,
        };
        result.push(...expanded.slice(1));
        continue;
      }
    }

    // 无法合并，直接追加
    result.push(...expanded);
  }

  return result;
}
