import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked, type Token } from "marked";
import { formatToken, type ThemeName } from "../utils/markdown.js";
import { MarkdownTable } from "./MarkdownTable.js";

/** Markdown 组件属性 */
export interface MarkdownProps {
  /** 要渲染的 Markdown 字符串 */
  children: string;
  /** 是否以 dim 颜色渲染所有文本 */
  dimColor?: boolean;
}

/**
 * 混合渲染 Markdown 内容：文本用 Text 组件，表格用 MarkdownTable 组件
 */
export function Markdown({ children, dimColor }: MarkdownProps): React.ReactElement {
  const theme: ThemeName = "dark";

  const tokens = useMemo(() => {
    return marked.lexer(children);
  }, [children]);

  const elements: React.ReactNode[] = [];
  let textBuffer = "";

  for (const token of tokens) {
    if (token.type === "table") {
      // 先刷新累积的非表格文本
      if (textBuffer) {
        elements.push(
          <Text key={elements.length} dimColor={dimColor}>
            {textBuffer}
          </Text>
        );
        textBuffer = "";
      }
      elements.push(
        <MarkdownTable key={elements.length} token={token as any} theme={theme} />
      );
    } else {
      textBuffer += formatToken(token, theme);
    }
  }

  // 刷新剩余的非表格文本
  if (textBuffer) {
    elements.push(
      <Text key={elements.length} dimColor={dimColor}>
        {textBuffer}
      </Text>
    );
  }

  return <Box flexDirection="column" gap={1}>{elements}</Box>;
}
