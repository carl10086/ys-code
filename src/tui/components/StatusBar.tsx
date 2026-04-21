// src/tui/components/StatusBar.tsx
import { Box, Text } from "ink";
import React from "react";

export interface StatusBarProps {
  /** 当前状态 */
  status: "idle" | "streaming" | "tool_executing";
  /** 模型名称 */
  modelName: string;
  /** 累计 token 总数 */
  totalTokens?: number;
  /** 模型 context window 大小 */
  contextWindow?: number;
  /** 累计费用（美元） */
  cost?: number;
}

/** 格式化 token 数量（超过 1000 显示为 K） */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(tokens);
}

/** 格式化美元金额 */
function formatCost(cost: number): string {
  return cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`;
}

/** 生成分数进度条 */
function renderProgressBar(percentage: number, width: number = 10): string {
  const filled = Math.min(width, Math.round((percentage / 100) * width));
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function StatusBar({ status, modelName, totalTokens, contextWindow, cost }: StatusBarProps): React.ReactElement {
  const statusText =
    status === "streaming"
      ? "Streaming..."
      : status === "tool_executing"
      ? "Executing tools..."
      : "Ready";

  const statusColor =
    status === "streaming" ? "yellow" : status === "tool_executing" ? "cyan" : "green";

  const percentage = totalTokens && contextWindow
    ? Math.round((totalTokens / contextWindow) * 100)
    : null;

  return (
    <Box height={1} flexDirection="row" justifyContent="space-between">
      <Text color={statusColor}>{statusText}</Text>
      <Box>
        <Text color="gray">{modelName}</Text>
        {percentage !== null && (
          <Text color="gray">
            {" "}[Context: {formatTokens(totalTokens!)}/{formatTokens(contextWindow!)} {renderProgressBar(percentage)} {percentage}%]
          </Text>
        )}
        {cost !== undefined && cost > 0 && (
          <Text color="gray"> [Cost: {formatCost(cost)}]</Text>
        )}
      </Box>
    </Box>
  );
}
