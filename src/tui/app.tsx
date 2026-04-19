// src/tui/app.tsx
import { Box } from "ink";
import React from "react";
import { logger } from "../utils/logger.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { COMMANDS, executeCommand } from "../commands/index.js";
import { MessageList } from "./components/MessageList.js";
import { PromptInput } from "./components/PromptInput.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgent } from "./hooks/useAgent.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

export function App(): React.ReactElement {
  const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage } = useAgent({
    model,
    apiKey,
  });

  const isStreaming = session.isStreaming;
  const hasPendingTools = session.pendingToolCalls.size > 0;
  const status = isStreaming ? (hasPendingTools ? "tool_executing" : "streaming") : "idle";

  const handleCommand = async (text: string): Promise<boolean> => {
    logger.debug("Command received", { command: text.trim() });
    const result = await executeCommand(text, {
      session,
      appendUserMessage,
      appendSystemMessage: (msg) => appendUserMessage(`[系统] ${msg}`),
    });
    return result.handled;
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    logger.info("User message submitted", { length: trimmed.length });

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
      <PromptInput disabled={false} onSubmit={handleSubmit} onCommand={handleCommand} commands={COMMANDS} />
      <StatusBar status={status} modelName={session.model.name} />
    </Box>
  );
}
