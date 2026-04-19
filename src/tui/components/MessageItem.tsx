// src/tui/components/MessageItem.tsx
import { Box, Text } from "ink";
import React from "react";
import type { UIMessage } from "../types.js";

export interface MessageItemProps {
  /** 要渲染的 UI 消息 */
  message: UIMessage;
}

export function MessageItem({ message }: MessageItemProps): React.ReactElement {
  switch (message.type) {
    case "user":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            {"> "}{message.text}
          </Text>
        </Box>
      );
    case "system":
      return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <Text color="yellow" bold>{"─".repeat(40)}</Text>
          <Text color="yellow" bold>{" ● "}{message.text}</Text>
          <Text color="yellow" bold>{"─".repeat(40)}</Text>
        </Box>
      );
    case "assistant_start":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Assistant</Text>
          <Text color="gray">{"─".repeat(40)}</Text>
        </Box>
      );
    case "thinking":
      return (
        <Box flexDirection="column">
          <Text dimColor>Thinking:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{message.text}</Text>
          </Box>
        </Box>
      );
    case "text":
      return (
        <Box flexDirection="column">
          <Text bold>Answer:</Text>
          <Text>{message.text}</Text>
        </Box>
      );
    case "tool_start":
      return (
        <Box flexDirection="column">
          <Text color="yellow">{"-> "}{message.toolName} {formatToolArgs(message.args)}</Text>
        </Box>
      );
    case "tool_end": {
      const status = message.isError ? "ERR" : "OK";
      const timeSec = (message.timeMs / 1000).toFixed(1);
      const color = message.isError ? "red" : "green";
      return (
        <Box flexDirection="column">
          <Text color={color}>
            {status} {message.toolName} {'->'} {message.summary} {timeSec}s
          </Text>
        </Box>
      );
    }
    case "assistant_end": {
      const timeSec = (message.timeMs / 1000).toFixed(1);
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">{"─".repeat(40)}</Text>
          <Text color="gray">
            Tokens: {message.tokens} | Cost: ${message.cost.toFixed(6)} | {timeSec}s
          </Text>
        </Box>
      );
    }
  }
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "()";
  }
  const entries = Object.entries(args).slice(0, 2);
  const pairs = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  const full = `(${pairs})`;
  if (full.length > 40) {
    return full.slice(0, 37) + "...";
  }
  return full;
}
