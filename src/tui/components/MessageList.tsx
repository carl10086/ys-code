// src/tui/components/MessageList.tsx
import { Box, useInput, useStdout } from "ink";
import React, { useEffect, useState } from "react";
import type { UIMessage } from "../types.js";
import { MessageItem } from "./MessageItem.js";

export interface MessageListProps {
  /** 消息列表 */
  messages: UIMessage[];
  /** 是否应自动滚动到底部 */
  shouldScrollToBottom: boolean;
  /** 滚动完成后回调 */
  onScrolled: () => void;
}

export function MessageList({ messages, shouldScrollToBottom, onScrolled }: MessageListProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();

  // 动态获取终端高度，减去输入框（约 5 行）和状态栏（1 行）
  const containerHeight = (stdout?.rows ?? 24) - 6;

  // 估算总高度：每类消息给一个近似行数
  const totalLines = messages.reduce((sum, m) => {
    switch (m.type) {
      case "user":
        return sum + Math.max(1, Math.ceil(m.text.length / 80));
      case "system":
        return sum + 1 + Math.max(1, Math.ceil(m.text.length / 76));
      case "assistant_start":
        return sum + 2;
      case "thinking":
        return sum + 1 + Math.max(1, Math.ceil(m.text.length / 76));
      case "text":
        return sum + 1 + Math.max(1, Math.ceil(m.text.length / 80));
      case "tool_start":
      case "tool_end":
        return sum + 1;
      case "assistant_end":
        return sum + 2;
    }
  }, 0);

  const maxScrollOffset = Math.max(0, totalLines - containerHeight);

  useEffect(() => {
    if (shouldScrollToBottom) {
      setScrollOffset(maxScrollOffset);
      onScrolled();
    }
  }, [shouldScrollToBottom, maxScrollOffset, onScrolled]);

  useInput((_, key) => {
    if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - 10));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(maxScrollOffset, o + 10));
    } else if (key.home) {
      setScrollOffset(0);
    } else if (key.end) {
      setScrollOffset(maxScrollOffset);
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginTop={-scrollOffset}>
        {messages
          .filter(m => !(m.type === "user" && m.isMeta))
          .map((message, index) => (
            <MessageItem key={index} message={message} />
          ))}
      </Box>
    </Box>
  );
}
