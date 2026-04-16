// src/tui/components/StatusBar.tsx
import { Box, Text } from "ink";
import React from "react";

export interface StatusBarProps {
  /** 当前状态 */
  status: "idle" | "streaming" | "tool_executing";
  /** 模型名称 */
  modelName: string;
}

export function StatusBar({ status, modelName }: StatusBarProps): React.ReactElement {
  const statusText =
    status === "streaming"
      ? "Streaming..."
      : status === "tool_executing"
      ? "Executing tools..."
      : "Ready";

  const statusColor =
    status === "streaming" ? "yellow" : status === "tool_executing" ? "cyan" : "green";

  return (
    <Box height={1} flexDirection="row" justifyContent="space-between">
      <Text color={statusColor}>{statusText}</Text>
      <Text color="gray">{modelName}</Text>
    </Box>
  );
}
