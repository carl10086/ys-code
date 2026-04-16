// src/tui/app.tsx
import { Box } from "ink";
import React from "react";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../agent/tools/index.js";
import { MessageList } from "./components/MessageList.js";
import { PromptInput } from "./components/PromptInput.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgent } from "./hooks/useAgent.js";

const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

export function App(): React.ReactElement {
  const { agent, messages, shouldScrollToBottom, markScrolled, appendUserMessage } = useAgent({
    systemPrompt,
    model,
    apiKey,
    tools: [
      createReadTool(process.cwd()),
      createWriteTool(process.cwd()),
      createEditTool(process.cwd()),
      createBashTool(process.cwd()),
    ],
  });

  const isStreaming = agent.state.isStreaming;
  const hasPendingTools = agent.state.pendingToolCalls.size > 0;
  const status = isStreaming ? (hasPendingTools ? "tool_executing" : "streaming") : "idle";

  const handleCommand = (text: string): boolean => {
    const command = text.trim();
    switch (command) {
      case "/exit":
        agent.waitForIdle().then(() => process.exit(0));
        return true;
      case "/new":
        agent.reset();
        return true;
      case "/system":
        return false;
      case "/tools":
        return false;
      case "/messages":
        return false;
      case "/abort":
        agent.abort();
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
      agent.steer({ role: "user", content: [{ type: "text", text: trimmed }], timestamp: Date.now() });
    } else {
      try {
        await agent.prompt(trimmed);
      } catch (err) {
        // 错误会通过 AgentEvent 的 message_update / agent_end 体现
      }
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <MessageList messages={messages} shouldScrollToBottom={shouldScrollToBottom} onScrolled={markScrolled} />
      <PromptInput disabled={false} onSubmit={handleSubmit} onCommand={handleCommand} />
      <StatusBar status={status} modelName={agent.state.model.name} />
    </Box>
  );
}
