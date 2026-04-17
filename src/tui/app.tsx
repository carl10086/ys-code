// src/tui/app.tsx
import { Box } from "ink";
import React from "react";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { MessageList } from "./components/MessageList.js";
import { PromptInput } from "./components/PromptInput.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgent } from "./hooks/useAgent.js";

const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

export function App(): React.ReactElement {
  const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage } = useAgent({
    systemPrompt,
    model,
    apiKey,
  });

  const isStreaming = session.isStreaming;
  const hasPendingTools = session.pendingToolCalls.size > 0;
  const status = isStreaming ? (hasPendingTools ? "tool_executing" : "streaming") : "idle";

  const handleCommand = (text: string): boolean => {
    const command = text.trim();
    switch (command) {
      case "/exit":
        session.waitForIdle().then(() => process.exit(0));
        return true;
      case "/new":
        session.reset();
        return true;
      case "/system":
        return false;
      case "/tools":
        return false;
      case "/messages":
        return false;
      case "/abort":
        session.abort();
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

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
      <PromptInput disabled={false} onSubmit={handleSubmit} onCommand={handleCommand} />
      <StatusBar status={status} modelName={session.model.name} />
    </Box>
  );
}
