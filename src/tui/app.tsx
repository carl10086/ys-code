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
import { gitBranchProvider } from "../utils/git-branch-provider.js";
import { setDebugAgentSession } from "../web/debug/debug-context.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

export function App(): React.ReactElement {
  const [commands, setCommands] = useState<Command[]>([]);

  useEffect(() => {
    getCommands(".claude/skills").then(setCommands);
  }, []);

  const [gitBranch, setGitBranch] = useState<string | null>(gitBranchProvider.getBranch());

  useEffect(() => {
    const unsubscribe = gitBranchProvider.onBranchChange(() => {
      setGitBranch(gitBranchProvider.getBranch());
    });
    return unsubscribe;
  }, []);

  const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage, resetSession, totalTokens } = useAgent({
    model,
    apiKey,
  });

  // 注册当前 AgentSession 到 Debug 桥接
  useEffect(() => {
    setDebugAgentSession(session);
    return () => {
      setDebugAgentSession(undefined);
    };
  }, [session]);

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

        // 处理 meta 消息 - 使用 prompt 数组在同一 turn 发送
        if (result.metaMessages && result.metaMessages.length > 0) {
          // 构建消息数组：用户输入 + meta messages
          const messages: AgentMessage[] = [
            { role: "user", content: [{ type: "text", text: trimmed }], timestamp: Date.now() },
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
          session.prompt(trimmed);
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
      <StatusBar
        status={status}
        modelName={session.model.name}
        cwd={process.cwd()}
        gitBranch={gitBranch}
        totalTokens={totalTokens}
        contextWindow={session.model.contextWindow}
      />
    </Box>
  );
}
