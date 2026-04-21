// src/tui/components/StatusBar.tsx
import { Box, Text } from "ink";
import React from "react";

export interface StatusBarProps {
  /** 当前状态 */
  status: "idle" | "streaming" | "tool_executing";
  /** 模型名称 */
  modelName: string;
  /** 当前工作目录（缩写格式） */
  cwd?: string;
  /** Git 分支名称 */
  gitBranch?: string | null;
  /** 累计 token 总数 */
  totalTokens?: number;
  /** 模型 context window 大小 */
  contextWindow?: number;
}

/** 格式化 token 数量（超过 1000 显示为 K） */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(tokens);
}

/** 格式化 cwd（缩写格式）：/Users/carl/project → ~/project */
function formatCwd(cwd: string): string {
  const home = process.env.HOME ?? "";
  if (home && cwd.startsWith(home)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

/** 生成分数进度条 */
function renderProgressBar(percentage: number, width: number = 10): string {
  const filled = Math.min(width, Math.round((percentage / 100) * width));
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function StatusBar({ status, modelName, cwd, gitBranch, totalTokens, contextWindow }: StatusBarProps): React.ReactElement {
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
    <>
      {/* 第一行：状态 + 模型 */}
      <Box height={1} flexDirection="row" justifyContent="space-between">
        <Text color={statusColor}>{statusText}</Text>
        <Text color="cyan">{modelName}</Text>
      </Box>
      {/* 第二行：cwd + git + context */}
      <Box height={1} flexDirection="row" justifyContent="space-between">
        <Box>
          {cwd && (
            <Text dimColor>[{formatCwd(cwd)}]</Text>
          )}
          {gitBranch && (
            <Text color="yellow"> [{gitBranch}]</Text>
          )}
        </Box>
        {percentage !== null && (
          <Text dimColor>
            [Context: {formatTokens(totalTokens!)}/{formatTokens(contextWindow!)} {renderProgressBar(percentage)} {percentage}%]
          </Text>
        )}
      </Box>
    </>
  );
}
