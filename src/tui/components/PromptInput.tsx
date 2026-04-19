// src/tui/components/PromptInput.tsx
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export interface PromptInputProps {
  /** 是否禁用提交 */
  disabled?: boolean;
  /** 提交回调 */
  onSubmit: (text: string) => void;
  /** 执行 slash 命令回调 */
  onCommand: (command: string) => boolean | Promise<boolean>;
}

export function PromptInput({ disabled, onSubmit, onCommand }: PromptInputProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((input, key) => {
    if (disabled) return;

    const insertNewline = () => {
      const line = lines[cursorLine] ?? "";
      const newLines = [...lines];
      newLines[cursorLine] = line.slice(0, cursorCol);
      newLines.splice(cursorLine + 1, 0, line.slice(cursorCol));
      setLines(newLines);
      setCursorLine((l) => l + 1);
      setCursorCol(0);
    };

    if (key.return) {
      const text = lines.join("\n").trim();
      if (!text) return;

      void (async () => {
        if (text.startsWith("/")) {
          const handled = await onCommand(text);
          if (handled) {
            setLines([""]);
            setCursorLine(0);
            setCursorCol(0);
            return;
          }
        }
        onSubmit(text);
        setHistory((h) => [...h, text]);
        setHistoryIndex(-1);
        setLines([""]);
        setCursorLine(0);
        setCursorCol(0);
      })();
      return;
    }

    if (key.escape || (key.ctrl && input === "c")) {
      process.exit(0);
      return;
    }

    if (key.upArrow) {
      if (cursorLine > 0) {
        setCursorLine((l) => l - 1);
        setCursorCol((c) => Math.min(c, lines[cursorLine - 1]?.length ?? 0));
      } else if (historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        const newLines = history[history.length - 1 - nextIndex].split("\n");
        setLines(newLines.length > 0 ? newLines : [""]);
        setCursorLine(0);
        setCursorCol(0);
      }
      return;
    }

    if (key.downArrow) {
      if (cursorLine < lines.length - 1) {
        setCursorLine((l) => l + 1);
        setCursorCol((c) => Math.min(c, lines[cursorLine + 1]?.length ?? 0));
      } else if (historyIndex >= 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        if (nextIndex < 0) {
          setLines([""]);
        } else {
          const newLines = history[history.length - 1 - nextIndex].split("\n");
          setLines(newLines.length > 0 ? newLines : [""]);
        }
        setCursorLine(0);
        setCursorCol(0);
      }
      return;
    }

    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol((c) => c - 1);
      } else if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1];
        setCursorLine((l) => l - 1);
        setCursorCol(prevLine?.length ?? 0);
      }
      return;
    }

    if (key.rightArrow) {
      const line = lines[cursorLine];
      if (cursorCol < (line?.length ?? 0)) {
        setCursorCol((c) => c + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine((l) => l + 1);
        setCursorCol(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        const line = lines[cursorLine];
        const newLine = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
        setLines((prev) => prev.map((l, i) => (i === cursorLine ? newLine : l)));
        setCursorCol((c) => c - 1);
      } else if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1];
        const currentLine = lines[cursorLine];
        const newLines = [...lines];
        newLines[cursorLine - 1] = prevLine + currentLine;
        newLines.splice(cursorLine, 1);
        setLines(newLines);
        setCursorLine((l) => l - 1);
        setCursorCol(prevLine.length);
      }
      return;
    }

    if (key.ctrl && input === "u") {
      setLines((prev) => prev.map((l, i) => (i === cursorLine ? "" : l)));
      setCursorCol(0);
      return;
    }

    if (input === "\r" || input === "\n" || input === "\r\n") {
      insertNewline();
      return;
    }

    // 处理某些终端中 Shift+Enter 发送的 escape sequence（如 [27;2;13~）
    if (input && input.startsWith("[") && input.endsWith("~") && input.includes(";")) {
      insertNewline();
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const line = lines[cursorLine] ?? "";
      const newLine = line.slice(0, cursorCol) + input + line.slice(cursorCol);
      setLines((prev) => prev.map((l, i) => (i === cursorLine ? newLine : l)));
      setCursorCol((c) => c + input.length);
    }
  });

  const displayLines = lines.map((line, i) => (
    <Text key={i}>
      {i === 0 ? "> " : "  "}
      {line}
      {i === cursorLine ? "█" : ""}
    </Text>
  ));

  return (
    <Box flexDirection="column" marginTop={1}>
      {displayLines}
    </Box>
  );
}
