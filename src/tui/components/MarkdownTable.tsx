import React from "react";
import { Box, Text } from "ink";
import type { Tokens } from "marked";
import stripAnsi from "strip-ansi";
import { formatToken, visibleWidth, padAligned, type ThemeName } from "../utils/markdown.js";

/** MarkdownTable 组件属性 */
export interface MarkdownTableProps {
  /** marked 表格 token */
  token: Tokens.Table;
  /** 主题名称 */
  theme: ThemeName;
}

/**
 * 从表格单元格 token 中提取纯文本内容
 * 使用 formatToken 渲染每个 cell 的 tokens，再去除 ANSI 转义序列
 */
function getCellText(cell: Tokens.TableCell, theme: ThemeName): string {
  const raw = cell.tokens.map((t) => formatToken(t, theme)).join("");
  // 去除 ANSI 控制字符，得到纯文本
  return stripAnsi(raw);
}

/**
 * 计算每列宽度：max(表头宽度, 该行该列宽度, 3)
 */
function computeColumnWidths(
  header: Tokens.TableCell[],
  rows: Tokens.TableCell[][],
  theme: ThemeName
): number[] {
  const colCount = header.length;
  const widths: number[] = new Array(colCount).fill(0);
  for (let c = 0; c < colCount; c++) {
    widths[c] = Math.max(widths[c], visibleWidth(getCellText(header[c]!, theme)), 3);
  }
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(widths[c], visibleWidth(getCellText(row[c]!, theme)), 3);
    }
  }
  return widths;
}

/**
 * 构建一行带边框的表格文本
 */
function buildRow(
  cells: string[],
  widths: number[],
  aligns: ("left" | "center" | "right" | null)[],
  left: string,
  sep: string,
  right: string
): string {
  let line = left;
  for (let i = 0; i < cells.length; i++) {
    const align = aligns[i] || "left";
    const padded = padAligned(cells[i]!, widths[i]!, align as "left" | "center" | "right");
    line += " " + padded + " ";
    if (i < cells.length - 1) {
      line += sep;
    }
  }
  line += right;
  return line;
}

/**
 * 构建表格分割线
 */
function buildSeparator(
  widths: number[],
  left: string,
  sep: string,
  right: string
): string {
  let line = left;
  for (let i = 0; i < widths.length; i++) {
    line += "─".repeat(widths[i]! + 2);
    if (i < widths.length - 1) {
      line += sep;
    }
  }
  line += right;
  return line;
}

export function MarkdownTable({ token, theme }: MarkdownTableProps): React.ReactElement {
  const header: Tokens.TableCell[] = token.header;
  const rows: Tokens.TableCell[][] = token.rows;
  const aligns = token.align;

  const colWidths = computeColumnWidths(header, rows, theme);

  /** 安全边距：终端宽度减去此值作为表格最大宽度 */
  const SAFETY_MARGIN = 4;

  // totalWidth calculation:
  // 每列宽度 = 内容宽度 + 2（左右padding）+ 1（右边框）
  // 最后一列不需要右边框，所以用初始值 1 来修正
  const totalWidth = colWidths.reduce((sum, w) => sum + w + 3, 1);
  const maxWidth = (process.stdout.columns || 80) - SAFETY_MARGIN;

  // 溢出处理：总宽度超过终端宽度时，渲染原始 markdown 文本
  if (totalWidth > maxWidth) {
    const raw = token.raw || "";
    return (
      <Box flexDirection="column">
        <Text>{raw}</Text>
      </Box>
    );
  }

  const headerTexts = header.map((cell) => getCellText(cell, theme));
  const rowTexts = rows.map((row) => row.map((cell) => getCellText(cell, theme)));

  const topSep = buildSeparator(colWidths, "┌", "┬", "┐");
  const midSep = buildSeparator(colWidths, "├", "┼", "┤");
  const botSep = buildSeparator(colWidths, "└", "┴", "┘");

  const lines: string[] = [];
  lines.push(topSep);
  lines.push(buildRow(headerTexts, colWidths, aligns, "│", "│", "│"));
  lines.push(midSep);
  for (const row of rowTexts) {
    lines.push(buildRow(row, colWidths, aligns, "│", "│", "│"));
  }
  lines.push(botSep);

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => (
        <Text key={idx}>{line}</Text>
      ))}
    </Box>
  );
}
