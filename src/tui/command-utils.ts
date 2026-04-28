import type { AgentMessage } from "../agent/types.js";
import type { ExecuteCommandResult } from "../commands/index.js";
import type { AgentSession } from "../agent/session.js";

/**
 * 分发命令执行结果到 UI 和会话
 * @returns 是否成功处理（result.handled）
 */
export function dispatchCommandResult(
  result: ExecuteCommandResult,
  text: string,
  session: AgentSession,
  appendUserMessage: (text: string) => void,
  appendSystemMessage: (text: string) => void,
): boolean {
  if (!result.handled) {
    return false;
  }

  // 显示用户输入
  appendUserMessage(text);

  // 处理 meta 消息 - 使用 prompt 数组在同一 turn 发送
  if (result.metaMessages && result.metaMessages.length > 0) {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
      ...result.metaMessages.map(
        (metaContent): AgentMessage => ({
          role: "user" as const,
          content: [{ type: "text" as const, text: metaContent }],
          timestamp: Date.now(),
          isMeta: true,
        }),
      ),
    ];
    session.prompt(messages);
  } else {
    session.prompt(text);
  }

  if (result.textResult) {
    appendSystemMessage(result.textResult);
  }

  return true;
}
