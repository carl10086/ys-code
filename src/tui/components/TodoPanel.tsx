import { Box, Text } from "ink";
import React from "react";
import type { TodoItem, TodoList } from "../../agent/todo/types.js";

export interface TodoPanelProps {
  todos: TodoList;
}

const SYMBOLS: Record<TodoItem["status"], string> = {
  pending: "☐",
  in_progress: "◐",
  completed: "☑",
};

const COLORS: Record<TodoItem["status"], string> = {
  pending: "white",
  in_progress: "yellow",
  completed: "green",
};

function renderItemText(item: TodoItem): string {
  return item.status === "in_progress" ? item.activeForm : item.content;
}

export function TodoPanel({ todos }: TodoPanelProps): React.ReactElement | null {
  if (todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>Tasks ({completedCount}/{todos.length})</Text>
      {todos.map((item) => (
        <Text key={item.content} color={COLORS[item.status]}>
          {SYMBOLS[item.status]} {renderItemText(item)}
        </Text>
      ))}
    </Box>
  );
}
