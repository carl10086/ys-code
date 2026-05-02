// src/tui/components/DiffRenderer.tsx
import { Box, Text } from "ink";
import type { StructuredPatchHunk } from "diff";
import { sanitizeTerminalText } from "../utils/sanitize-terminal-text.js";

/** DiffRenderer 组件属性 */
interface DiffRendererProps {
  /** 文件路径 */
  filePath: string;
  /** Diff hunks 列表 */
  hunks: StructuredPatchHunk[];
}

/**
 * 渲染彩色 unified diff。
 * - 添加行（+）：绿色
 * - 删除行（-）：红色
 * - 标题行（@@）：黄色
 * - 上下文行（空格）：灰色
 */
export function DiffRenderer({ filePath, hunks }: DiffRendererProps) {
  const safeFilePath = sanitizeTerminalText(filePath);
  if (hunks.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color="gray">No diff available for {safeFilePath}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="cyan">{`--- a/${safeFilePath}`}</Text>
      <Text color="cyan">{`+++ b/${safeFilePath}`}</Text>
      {hunks.map((hunk, hunkIndex) => (
        <Box key={hunkIndex} flexDirection="column">
          <Text color="yellow">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </Text>
          {hunk.lines.map((line, lineIndex) => {
            const safeLine = sanitizeTerminalText(line);
            if (safeLine.startsWith("+")) {
              return <Text key={lineIndex} color="green">{safeLine}</Text>;
            }
            if (safeLine.startsWith("-")) {
              return <Text key={lineIndex} color="red">{safeLine}</Text>;
            }
            return <Text key={lineIndex} color="gray">{safeLine}</Text>;
          })}
        </Box>
      ))}
    </Box>
  );
}
