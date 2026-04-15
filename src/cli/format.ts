// src/cli/format.ts

/** 参数格式化的最大长度 */
const MAX_TOOL_LINE_LENGTH = 40;

/** 格式化用户消息 */
export function formatUserMessage(text: string): string {
  return `\n> ${text}\n`;
}

/** 格式化 AI 卡片开始 */
export function formatAICardStart(_modelName: string): string {
  return "Assistant\n---\n";
}

/** 格式化 Thinking 标签前缀 */
export function formatThinkingPrefix(): string {
  return "Thinking:\n  ";
}

/** 格式化 thinking 增量 */
export function formatThinkingDelta(delta: string): string {
  return delta;
}

/** 格式化 Answer 标签前缀 */
export function formatAnswerPrefix(): string {
  return "\nAnswer:\n";
}

/** 格式化正文增量 */
export function formatTextDelta(delta: string): string {
  return delta;
}

/** 格式化 Tools 标签前缀 */
export function formatToolsPrefix(): string {
  return "\nTools:\n";
}

/** 格式化工具开始 */
export function formatToolStart(toolName: string, args: unknown): string {
  return `-> ${toolName}${formatToolArgs(args)}\n`;
}

/** 格式化工具结束 */
export function formatToolEnd(
  toolName: string,
  isError: boolean,
  summary: string,
  timeMs: number,
): string {
  const status = isError ? "ERR" : "OK";
  const timeSec = (timeMs / 1000).toFixed(1);
  return `${status} ${toolName} -> ${summary} ${timeSec}s\n`;
}

/** 格式化 AI 卡片结束 */
export function formatAICardEnd(tokens: number, cost: number, timeMs: number): string {
  const timeSec = (timeMs / 1000).toFixed(1);
  return `---\nTokens: ${tokens} | Cost: $${cost.toFixed(6)} | ${timeSec}s\n`;
}

/** 将工具参数格式化为字符串 */
function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "()";
  }
  const entries = Object.entries(args).slice(0, 2);
  const pairs = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  const full = `(${pairs})`;
  if (full.length > MAX_TOOL_LINE_LENGTH) {
    return full.slice(0, MAX_TOOL_LINE_LENGTH - 3) + "...";
  }
  return full;
}
