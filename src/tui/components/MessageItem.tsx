// src/tui/components/MessageItem.tsx
import { Box, Text } from "ink";
import React from "react";
import type { UIMessage } from "../types.js";
import type { ToolRenderResult } from "../../agent/types.js";
import { Markdown } from "./Markdown.js";
import { DiffRenderer } from "./DiffRenderer.js";

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
          <Text dimColor>{"ℹ "}{message.text}</Text>
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
            <Markdown dimColor>{message.text}</Markdown>
          </Box>
        </Box>
      );
    case "text":
      return (
        <Box flexDirection="column">
          <Text bold>Answer:</Text>
          <Markdown>{message.text}</Markdown>
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

      if (!message.isError && message.renderData) {
        if (message.renderData.type === "structured_diff") {
          return (
            <Box flexDirection="column">
              <Text color={color}>
                {status} {message.toolName} {"->"} {timeSec}s
              </Text>
              <DiffRenderer
                filePath={message.renderData.filePath}
                hunks={message.renderData.hunks}
              />
            </Box>
          );
        }
        if (message.renderData.type === "plain") {
          return (
            <Box flexDirection="column">
              <Text color={color}>
                {status} {message.toolName} {"->"} {message.renderData.text} {timeSec}s
              </Text>
            </Box>
          );
        }
        if (message.renderData.type === "search_result") {
          const { summary, details } = formatSearchResult(message.renderData);
          return (
            <Box flexDirection="column">
              <Text color={color}>
                {status} {message.toolName} {"->"} {summary} {timeSec}s
              </Text>
              {details ? (
                <Box paddingLeft={2}>
                  <Text>{details}</Text>
                </Box>
              ) : null}
            </Box>
          );
        }
      }

      return (
        <Box flexDirection="column">
          <Text color={color}>
            {status} {message.toolName} {"->"} {message.summary} {timeSec}s
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

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function formatSearchResult(renderData: Extract<ToolRenderResult, { type: "search_result" }>): { summary: string; details: string } {
  if (renderData.mode === "content") {
    const count = renderData.numLines ?? 0;
    return {
      summary: `Found ${count} ${plural(count, "line")}`,
      details: renderData.content ?? "",
    };
  }

  if (renderData.mode === "count") {
    const matches = renderData.numMatches ?? 0;
    const files = renderData.numFiles;
    return {
      summary: `Found ${matches} ${plural(matches, "match", "matches")} across ${files} ${plural(files, "file")}`,
      details: renderData.content ?? "",
    };
  }

  return {
    summary: `Found ${renderData.numFiles} ${plural(renderData.numFiles, "file")}`,
    details: renderData.filenames.join("\n"),
  };
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
