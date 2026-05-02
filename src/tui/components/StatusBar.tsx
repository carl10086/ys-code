// src/tui/components/StatusBar.tsx
import { Box, Text } from "ink";
import React from "react";
import type { Usage } from "../../core/ai/index.js";

export interface StatusBarProps {
  /** 当前状态 */
  status: "idle" | "streaming" | "tool_executing";
  /** 模型名称 */
  modelName: string;
  /** 当前工作目录（缩写格式） */
  cwd?: string;
  /** Git 分支名称 */
  gitBranch?: string | null;
  /** 最近一次 API 响应的 usage（对齐 cc StatusLine 的 getCurrentUsage） */
  lastUsage?: Usage | null;
  /** 模型 context window 大小 */
  contextWindow?: number;
  /** Web 服务器访问 URL */
  webUrl?: string;
}

/** 从 URL 中提取端口号 */
function extractPortFromUrl(url: string): string {
  try {
    return new URL(url).port;
  } catch {
    return "";
  }
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

export function StatusBar({ status, modelName, cwd, gitBranch, lastUsage, contextWindow, webUrl }: StatusBarProps): React.ReactElement {
  const statusText =
    status === "streaming"
      ? "Streaming..."
      : status === "tool_executing"
      ? "Executing tools..."
      : "Ready";

  const statusColor =
    status === "streaming" ? "yellow" : status === "tool_executing" ? "cyan" : "green";

  // 对齐 cc utils/context.ts:calculateContextPercentages —— 仅 input + cache，不含 output
  const tokensInContext = lastUsage
    ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite
    : 0;
  const percentage = lastUsage && contextWindow
    ? Math.min(100, Math.round((tokensInContext / contextWindow) * 100))
    : null;

  return (
    <>
      {/* 第一行：状态 + 模型 */}
      <Box height={1} flexDirection="row" justifyContent="space-between">
        <Text color={statusColor}>{statusText}</Text>
        <Text color="cyan">{modelName}</Text>
      </Box>
      {/* 第二行：web + cwd + git + context */}
      <Box height={1} flexDirection="row" justifyContent="space-between">
        <Box>
          {webUrl && extractPortFromUrl(webUrl) && (
            <Text color="magenta">[Web: {extractPortFromUrl(webUrl)}]</Text>
          )}
          {cwd && (
            <Text dimColor>{webUrl ? " " : ""}[{formatCwd(cwd)}]</Text>
          )}
          {gitBranch && (
            <Text color="yellow"> [{gitBranch}]</Text>
          )}
        </Box>
        {percentage !== null && (
          <Text dimColor>
            [Context: {formatTokens(tokensInContext)}/{formatTokens(contextWindow!)} {renderProgressBar(percentage)} {percentage}%]
          </Text>
        )}
      </Box>
    </>
  );
}
