// src/tui/components/CommandSuggestions.tsx
import { Box, Text } from "ink";
import React from "react";

/** 建议项数据结构 */
export interface SuggestionItem {
  /** 唯一标识 */
  id: string;
  /** 显示文本（如 "/clear"） */
  displayText: string;
  /** 描述文本 */
  description: string;
}

export interface CommandSuggestionsProps {
  /** 建议列表 */
  items: SuggestionItem[];
  /** 当前选中索引 */
  selectedIndex: number;
}

/** 最大显示项数 */
const MAX_VISIBLE_ITEMS = 5;

export function CommandSuggestions({ items, selectedIndex }: CommandSuggestionsProps): React.ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const maxDisplayWidth = Math.max(...visibleItems.map(item => item.displayText.length));

  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(40)}</Text>
      {visibleItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        const padding = " ".repeat(Math.max(1, maxDisplayWidth - item.displayText.length + 2));
        return (
          <Text key={item.id} color={isSelected ? "cyan" : undefined} dimColor={!isSelected}>
            {item.displayText}{padding}{item.description}
          </Text>
        );
      })}
    </Box>
  );
}
