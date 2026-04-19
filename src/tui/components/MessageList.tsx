// src/tui/components/MessageList.tsx
import { Box, useInput } from "ink";
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

  // 估算总高度：每类消息给一个近似行数
  const totalLines = messages.reduce((sum, m) => {
    switch (m.type) {
      case "user":
        return sum + Math.max(1, Math.ceil(m.text.length / 80));
      case "system":
        return sum + 3 + Math.max(1, Math.ceil(m.text.length / 76));
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

  // 估算容器可用行数（默认终端高度 24，减去输入框 3 行和状态栏 1 行）
  const containerHeight = 20;
  const maxScrollOffset = Math.max(0, totalLines - containerHeight);

  useEffect(() => {
    if (shouldScrollToBottom) {
      setScrollOffset(maxScrollOffset);
      onScrolled();
    }
  }, [shouldScrollToBottom, maxScrollOffset, onScrolled]);

  useInput((_, key) => {
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxScrollOffset, o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - 5));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(maxScrollOffset, o + 5));
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginTop={-scrollOffset}>
        {messages.map((message, index) => (
          <MessageItem key={index} message={message} />
        ))}
      </Box>
    </Box>
  );
}
