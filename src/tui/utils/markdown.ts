import { marked, type Token } from "marked";
import chalk from "chalk";
import stripAnsi from "strip-ansi";

/** 主题名称 */
export type ThemeName = "light" | "dark";

/**
 * 计算字符串在终端中的可见宽度（去除 ANSI 控制字符）
 */
export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * 按目标宽度对齐文本（左对齐，右填充空格）
 */
export function padAligned(
  content: string,
  targetWidth: number,
  align: "left" | "right" | "center" = "left"
): string {
  const width = visibleWidth(content);
  if (width >= targetWidth) return content;
  const pad = targetWidth - width;
  if (align === "right") return " ".repeat(pad) + content;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return " ".repeat(left) + content + " ".repeat(right);
  }
  return content + " ".repeat(pad);
}

/**
 * 根据主题获取 codespan 颜色
 */
function getCodespanColor(theme: ThemeName) {
  return theme === "dark" ? chalk.cyan : chalk.blue;
}

/**
 * 格式化单个 marked Token 为 ANSI 字符串
 */
export function formatToken(
  token: Token,
  theme: ThemeName,
  listDepth: number = 0,
  orderedListNumber: number | null = null
): string {
  switch (token.type) {
    case "heading": {
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme)).join("")
        : token.text;
      if (token.depth === 1) {
        return chalk.bold.italic.underline(text) + "\n";
      }
      return chalk.bold(text) + "\n";
    }

    case "code": {
      const lines = (token as any).text.split("\n");
      return lines.map((line: string) => "  " + chalk.gray(line)).join("\n") + "\n";
    }

    case "codespan": {
      return getCodespanColor(theme)(token.text);
    }

    case "strong": {
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme)).join("")
        : token.text;
      return chalk.bold(text);
    }

    case "em": {
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme)).join("")
        : token.text;
      return chalk.italic(text);
    }

    case "blockquote": {
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme)).join("")
        : token.text;
      const lines = text.split("\n");
      return (
        lines.map((line: string) => chalk.gray("│ ") + chalk.italic(line)).join("\n") +
        "\n"
      );
    }

    case "link": {
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme)).join("")
        : token.text;
      // OSC 8 hyperlink
      return `\x1b]8;;${token.href}\x1b\\${text}\x1b]8;;\x1b\\`;
    }

    case "list": {
      const items = (token as any).items || [];
      const isOrdered = (token as any).ordered ?? false;
      let result = "";
      let num = 1;
      for (const item of items) {
        result += formatToken(item, theme, listDepth + 1, isOrdered ? num++ : null);
      }
      return result;
    }

    case "list_item": {
      const indent = "  ".repeat(listDepth);
      const marker = orderedListNumber !== null ? `${orderedListNumber}. ` : "• ";
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme, listDepth)).join("")
        : token.text;
      // Remove trailing newline from inner tokens to avoid double newlines
      const trimmed = text.replace(/\n$/, "");
      return indent + marker + trimmed + "\n";
    }

    case "paragraph": {
      const text = token.tokens
        ? token.tokens.map((t) => formatToken(t, theme)).join("")
        : token.text;
      return text + "\n";
    }

    case "space": {
      return "";
    }

    case "table": {
      // 表格由 MarkdownTable 组件单独渲染
      return "";
    }

    case "text": {
      if (token.tokens) {
        return token.tokens.map((t) => formatToken(t, theme)).join("");
      }
      return token.text;
    }

    default: {
      return (token as any).text || "";
    }
  }
}

/**
 * 将 Markdown 字符串渲染为 ANSI 格式文本
 */
export function applyMarkdown(content: string, theme: ThemeName): string {
  const tokens = marked.lexer(content);
  return tokens.map((token) => formatToken(token, theme)).join("");
}
