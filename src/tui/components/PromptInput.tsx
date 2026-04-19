// src/tui/components/PromptInput.tsx
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { Command } from "../../commands/types.js";
import { CommandSuggestions, type SuggestionItem } from "./CommandSuggestions.js";
import Fuse from "fuse.js";

export interface PromptInputProps {
  /** 是否禁用提交 */
  disabled?: boolean;
  /** 提交回调 */
  onSubmit: (text: string) => void;
  /** 执行 slash 命令回调 */
  onCommand: (command: string) => boolean | Promise<boolean>;
  /** 可用命令列表（用于自动提示） */
  commands?: Command[];
}

export function PromptInput({ disabled, onSubmit, onCommand, commands = [] }: PromptInputProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filterCommands = React.useCallback((inputText: string, availableCommands: Command[] = []): SuggestionItem[] => {
    const query = inputText.slice(1).toLowerCase().trim();

    if (query === "") {
      return availableCommands
        .filter(cmd => !cmd.isHidden)
        .map(cmd => ({
          id: cmd.name,
          displayText: `/${cmd.name}`,
          description: cmd.description,
        }));
    }

    const fuse = new Fuse(availableCommands.filter(cmd => !cmd.isHidden), {
      keys: [
        { name: "name", weight: 3 },
        { name: "aliases", weight: 2 },
        { name: "description", weight: 0.5 },
      ],
      threshold: 0.3,
      includeScore: true,
    });

    const results = fuse.search(query);
    return results.map(result => ({
      id: result.item.name,
      displayText: `/${result.item.name}`,
      description: result.item.description,
    }));
  }, []);

  React.useEffect(() => {
    const text = lines.join("\n");
    if (text.startsWith("/") && !text.includes(" ") && commands.length > 0) {
      const items = filterCommands(text, commands);
      setSuggestions(items);
      setShowSuggestions(items.length > 0);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  }, [lines, commands, filterCommands]);

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
      // 如果有建议列表，应用选中的建议并执行
      if (showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedSuggestion];
        if (selected) {
          const commandText = selected.displayText;
          setShowSuggestions(false);
          setLines([""]);
          setCursorLine(0);
          setCursorCol(0);
          void (async () => {
            const handled = await onCommand(commandText);
            if (!handled) {
              onSubmit(commandText);
            }
          })();
          return;
        }
      }

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

    if (key.tab) {
      if (showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedSuggestion];
        if (selected) {
          const newText = selected.displayText + " ";
          setLines([newText]);
          setCursorLine(0);
          setCursorCol(newText.length);
          setShowSuggestions(false);
        }
        return;
      }
    }

    if (key.escape || (key.ctrl && input === "c")) {
      // 如果有建议列表，先关闭它
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }
      process.exit(0);
      return;
    }

    if (key.upArrow) {
      // 如果建议列表可见，优先控制建议选择
      if (showSuggestions && suggestions.length > 0) {
        setSelectedSuggestion(prev => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
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
      // 如果建议列表可见，优先控制建议选择
      if (showSuggestions && suggestions.length > 0) {
        setSelectedSuggestion(prev => (prev >= suggestions.length - 1 ? 0 : prev + 1));
        return;
      }
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
      {showSuggestions && (
        <CommandSuggestions items={suggestions} selectedIndex={selectedSuggestion} />
      )}
    </Box>
  );
}
