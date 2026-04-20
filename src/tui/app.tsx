// src/tui/app.tsx
import { Box } from "ink";
import React, { useEffect, useState } from "react";
import type { AgentMessage } from "../agent/types.js";
import type { Command } from "../commands/index.js";
import { logger } from "../utils/logger.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { executeCommand, getCommands } from "../commands/index.js";
import { MessageList } from "./components/MessageList.js";
import { PromptInput } from "./components/PromptInput.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgent } from "./hooks/useAgent.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

export function App(): React.ReactElement {
  const [commands, setCommands] = useState<Command[]>([]);

  useEffect(() => {
    getCommands(".claude/skills").then(setCommands);
  }, []);

  const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage, resetSession } = useAgent({
    model,
    apiKey,
  });

  const isStreaming = session.isStreaming;
  const hasPendingTools = session.pendingToolCalls.size > 0;
  const status = isStreaming ? (hasPendingTools ? "tool_executing" : "streaming") : "idle";

  const handleCommand = async (text: string): Promise<boolean> => {
    const result = await executeCommand(text, {
      session,
      appendUserMessage,
      appendSystemMessage,
      resetSession,
    });
    if (result.handled && result.textResult) {
      appendSystemMessage(result.textResult);
    }
    return result.handled;
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    logger.info("User message submitted", { length: trimmed.length });

    // 检查是否是 slash 命令
    if (trimmed.startsWith("/")) {
      const result = await executeCommand(trimmed, {
        session,
        appendUserMessage,
        appendSystemMessage,
        resetSession,
      });

      if (result.handled) {
        // 显示用户输入
        appendUserMessage(trimmed);

        // 处理 meta 消息 - 使用 steer 加入队列，不触发立即响应
        if (result.metaMessages && result.metaMessages.length > 0) {
          for (const metaContent of result.metaMessages) {
            logger.debug("Steering meta message to LLM", { contentLength: metaContent.length });
            const metaMessage: AgentMessage = {
              role: "user",
              content: [{ type: "text", text: metaContent }],
              timestamp: Date.now(),
              isMeta: true,
            };
            session.steer(metaMessage);
          }
        }

        if (result.textResult) {
          appendSystemMessage(result.textResult);
        }
        return;
      }
    }

    // 普通用户消息
    appendUserMessage(trimmed);
    if (isStreaming) {
      session.steer(trimmed);
    } else {
      try {
        await session.prompt(trimmed);
      } catch (err) {
        // 错误会通过 AgentSessionEvent 的 turn_end 体现
      }
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <MessageList messages={messages} shouldScrollToBottom={shouldScrollToBottom} onScrolled={markScrolled} />
      <PromptInput disabled={false} onSubmit={handleSubmit} onCommand={handleCommand} commands={commands} />
      <StatusBar status={status} modelName={session.model.name} />
    </Box>
  );
}
