import React, { useMemo } from "react";
import { Box } from "ink";
import { marked, type Tokens } from "marked";
import { formatToken } from "../utils/markdown.js";
import { MarkdownTable } from "./MarkdownTable.js";
import { Ansi } from "./Ansi.js";

/** Markdown 组件属性 */
export interface MarkdownProps {
  /** 要渲染的 Markdown 字符串 */
  children: string;
  /** 是否以 dim 颜色渲染所有文本 */
  dimColor?: boolean;
}

/**
 * 混合渲染 Markdown 内容：文本用 Ansi 组件解析 ANSI 序列，表格用 MarkdownTable 组件
 */
export function Markdown({ children, dimColor }: MarkdownProps): React.ReactElement {
  const theme = "dark";

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
          <Ansi key={elements.length} dimColor={dimColor}>
            {textBuffer}
          </Ansi>
        );
        textBuffer = "";
      }
      elements.push(
        <MarkdownTable key={elements.length} token={token as Tokens.Table} theme={theme} />
      );
    } else {
      textBuffer += formatToken(token, theme);
    }
  }

  // 刷新剩余的非表格文本
  if (textBuffer) {
    elements.push(
      <Ansi key={elements.length} dimColor={dimColor}>
        {textBuffer}
      </Ansi>
    );
  }

  return <Box flexDirection="column" gap={1}>{elements}</Box>;
}
