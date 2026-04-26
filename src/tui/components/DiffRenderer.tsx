// src/tui/components/DiffRenderer.tsx
import { Box, Text } from "ink";
import type { StructuredPatchHunk } from "diff";

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
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="cyan">{`--- a/${filePath}`}</Text>
      <Text color="cyan">{`+++ b/${filePath}`}</Text>
      {hunks.map((hunk, hunkIndex) => (
        <Box key={hunkIndex} flexDirection="column">
          <Text color="yellow">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </Text>
          {hunk.lines.map((line, lineIndex) => {
            if (line.startsWith("+")) {
              return <Text key={lineIndex} color="green">{line}</Text>;
            }
            if (line.startsWith("-")) {
              return <Text key={lineIndex} color="red">{line}</Text>;
            }
            return <Text key={lineIndex} color="gray">{line}</Text>;
          })}
        </Box>
      ))}
    </Box>
  );
}
