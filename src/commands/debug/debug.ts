// src/commands/debug/debug.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async (_args, context) => {
  const { session } = context;

  const debugData = {
    sessionId: session.sessionId,
    model: session.model.name,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
    systemPrompt: session.getSystemPrompt(),
    messages: session.messages.map((msg) => {
      // AgentMessage is a union type that includes AttachmentMessage which has 'attachment' instead of 'content'
      const content = "content" in msg
        ? (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content))
        : JSON.stringify("attachment" in msg ? msg.attachment : msg);
      return {
        role: msg.role,
        content,
        timestamp: msg.timestamp,
      };
    }),
  };

  const filePath = join(process.cwd(), "debug-context.json");

  try {
    writeFileSync(filePath, JSON.stringify(debugData, null, 2), "utf-8");
    return { type: "text", value: `已导出上下文到 ${filePath}` };
  } catch (error) {
    return { type: "text", value: `导出失败: ${error}` };
  }
};
