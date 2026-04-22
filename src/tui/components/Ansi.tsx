import React, { useMemo } from "react";
import { Text } from "ink";
import { parseAnsiSequences, type ParseToken, type Color } from "ansi-sequence-parser";

/** Ansi 组件属性 */
export interface AnsiProps {
  /** 包含 ANSI 转义序列的字符串 */
  children: string;
  /** 是否以 dim 颜色渲染所有文本 */
  dimColor?: boolean;
}

/** 将 parser 颜色映射为 Ink color 字符串 */
function mapColor(color: Color | null): string | undefined {
  if (!color) return undefined;
  switch (color.type) {
    case "named":
      return color.name;
    case "table":
      return `ansi256(${color.index})`;
    case "rgb":
      return `rgb(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]})`;
    default:
      return undefined;
  }
}

/** 将 decorations Set 映射为 Ink Text 属性对象 */
function mapDecorations(decorations: Set<string>) {
  const props: Record<string, boolean> = {};
  for (const d of decorations) {
    switch (d) {
      case "bold":
        props.bold = true;
        break;
      case "dim":
        props.dimColor = true;
        break;
      case "italic":
        props.italic = true;
        break;
      case "underline":
        props.underline = true;
        break;
      case "strikethrough":
        props.strikethrough = true;
        break;
      case "reverse":
        props.inverse = true;
        break;
    }
  }
  return props;
}

/** 判断两个 token 的样式是否相同，用于合并 */
function sameStyle(a: ParseToken, b: ParseToken): boolean {
  if (a.foreground?.type !== b.foreground?.type) return false;
  if (a.foreground?.type === "named" && (a.foreground as any).name !== (b.foreground as any).name) return false;
  if (a.foreground?.type === "table" && (a.foreground as any).index !== (b.foreground as any).index) return false;
  if (a.foreground?.type === "rgb" && (
    (a.foreground as any).rgb[0] !== (b.foreground as any).rgb[0] ||
    (a.foreground as any).rgb[1] !== (b.foreground as any).rgb[1] ||
    (a.foreground as any).rgb[2] !== (b.foreground as any).rgb[2]
  )) return false;

  if (a.background?.type !== b.background?.type) return false;
  if (a.background?.type === "named" && (a.background as any).name !== (b.background as any).name) return false;
  if (a.background?.type === "table" && (a.background as any).index !== (b.background as any).index) return false;
  if (a.background?.type === "rgb" && (
    (a.background as any).rgb[0] !== (b.background as any).rgb[0] ||
    (a.background as any).rgb[1] !== (b.background as any).rgb[1] ||
    (a.background as any).rgb[2] !== (b.background as any).rgb[2]
  )) return false;

  if (a.decorations.size !== b.decorations.size) return false;
  for (const d of a.decorations) {
    if (!b.decorations.has(d)) return false;
  }
  return true;
}

/** 合并相邻的相同样式 token */
function mergeTokens(tokens: ParseToken[]): ParseToken[] {
  if (tokens.length === 0) return [];
  const merged: ParseToken[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const last = merged[merged.length - 1];
    const current = tokens[i];
    if (sameStyle(last, current)) {
      last.value += current.value;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * 将 ANSI 转义序列解析为 Ink Text 组件序列
 */
export const Ansi = React.memo(function Ansi({ children, dimColor }: AnsiProps): React.ReactElement {
  const tokens = useMemo(() => {
    const parsed = parseAnsiSequences(children);
    return mergeTokens(parsed);
  }, [children]);

  return (
    <Text dimColor={dimColor}>
      {tokens.map((token, i) => {
        const color = mapColor(token.foreground);
        const bg = mapColor(token.background);
        const deco = mapDecorations(token.decorations);

        return (
          <Text
            key={i}
            color={color}
            backgroundColor={bg}
            dimColor={deco.dimColor || dimColor}
            bold={deco.bold}
            italic={deco.italic}
            underline={deco.underline}
            strikethrough={deco.strikethrough}
            inverse={deco.inverse}
          >
            {token.value}
          </Text>
        );
      })}
    </Text>
  );
});
