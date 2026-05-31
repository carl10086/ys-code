import { Box, Text } from "ink";
import React from "react";
import type { TodoItem, TodoList } from "../../agent/todo/types.js";

export interface TodoPanelProps {
  todos: TodoList;
}

const SYMBOLS: Record<TodoItem["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

function renderProgressBar(completed: number, total: number, width = 20): string {
  const ratio = total === 0 ? 0 : completed / total;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}%`;
}

function renderItemText(item: TodoItem): string {
  return item.status === "in_progress" ? item.activeForm : item.content;
}

function TodoItemLine({ item, index }: { item: TodoItem; index: number }): React.ReactElement {
  const text = `${SYMBOLS[item.status]} ${index + 1}. ${renderItemText(item)}`;
  if (item.status === "in_progress") {
    return <Text color="yellow" bold>{text}</Text>;
  }
  if (item.status === "completed") {
    return <Text color="green" dimColor>{text}</Text>;
  }
  return <Text color="gray">{text}</Text>;
}

export function TodoPanel({ todos }: TodoPanelProps): React.ReactElement | null {
  if (todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>Tasks {completedCount}/{todos.length}</Text>
      <Text dimColor>{renderProgressBar(completedCount, todos.length)}</Text>
      {todos.map((item, index) => (
        <TodoItemLine key={index} item={item} index={index} />
      ))}
    </Box>
  );
}
