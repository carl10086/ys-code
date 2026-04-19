# 命令帮助与自动补全实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/help` 命令和输入 `/` 时的自动提示补全功能，对齐 claude-code 的交互体验。

**Architecture:** 基于现有 command system 扩展：新增 `/help` 命令输出格式化帮助文本；在 PromptInput 中集成 Fuse.js 模糊匹配和 suggestion 状态管理；新增 CommandSuggestions 组件渲染建议列表。

**Tech Stack:** TypeScript, React, Ink, Fuse.js

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `src/commands/help/index.ts` | help 命令入口（懒加载声明） |
| `src/commands/help/help.ts` | help 命令实现（格式化输出命令列表） |
| `src/tui/components/CommandSuggestions.tsx` | 命令建议列表渲染组件 |
| `src/tui/components/PromptInput.tsx` | 添加 suggestion 状态管理和键盘交互 |
| `src/tui/app.tsx` | 传递 commands 数组给 PromptInput |
| `src/commands/index.ts` | 注册 help 命令到 COMMANDS 数组 |

---

## Task 1: 安装 Fuse.js 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 fuse.js**

```bash
npm install fuse.js
```

- [ ] **Step 2: 验证安装成功**

```bash
ls node_modules/fuse.js/dist/fuse.d.ts
```

Expected: 文件存在

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add fuse.js for command fuzzy matching"
```

---

## Task 2: 实现 /help 命令

**Files:**
- Create: `src/commands/help/index.ts`
- Create: `src/commands/help/help.ts`
- Modify: `src/commands/index.ts`

**Context:** `/help` 是一个 `local` 类型命令，遍历 `COMMANDS` 数组，过滤 `isHidden` 的命令，按名称字母顺序排序，输出格式化的命令列表。每个命令一行，格式：`/{name} (alias1, alias2)    {description}`。

- [ ] **Step 1: 创建 help 命令入口**

Create `src/commands/help/index.ts`:

```typescript
// src/commands/help/index.ts
import type { Command } from "../types.js";

const help = {
  type: "local",
  name: "help",
  description: "显示所有可用命令",
  load: () => import("./help.js"),
} satisfies Command;

export default help;
```

- [ ] **Step 2: 创建 help 命令实现**

Create `src/commands/help/help.ts`:

```typescript
// src/commands/help/help.ts
import type { LocalCommandCall } from "../types.js";
import { COMMANDS } from "../index.js";
import { getCommandName, isCommandEnabled } from "../types.js";

export const call: LocalCommandCall = async (_args, _context) => {
  const visibleCommands = COMMANDS
    .filter(cmd => !cmd.isHidden && isCommandEnabled(cmd))
    .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)));

  if (visibleCommands.length === 0) {
    return { type: "text", value: "暂无可用命令。" };
  }

  const lines = visibleCommands.map(cmd => {
    const name = getCommandName(cmd);
    const aliasText = cmd.aliases && cmd.aliases.length > 0
      ? ` (${cmd.aliases.join(", ")})`
      : "";
    const padding = " ".repeat(Math.max(1, 12 - name.length - aliasText.length));
    return `/${name}${aliasText}${padding}${cmd.description}`;
  });

  const value = ["可用命令：", "", ...lines].join("\n");
  return { type: "text", value };
};
```

- [ ] **Step 3: 注册 help 命令**

Modify `src/commands/index.ts`:

```typescript
// 在现有 import 下方添加
import help from "./help/index.js";

// 在 COMMANDS 数组中添加 help
export const COMMANDS: Command[] = [
  exit,
  clear,
  tools,
  help,
];
```

- [ ] **Step 4: 验证类型检查通过**

```bash
bunx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/commands/help/ src/commands/index.ts
git commit -m "feat(commands): add /help command to list all available commands"
```

---

## Task 3: 创建 CommandSuggestions 组件

**Files:**
- Create: `src/tui/components/CommandSuggestions.tsx`

**Context:** 该组件接收建议列表和选中索引，渲染命令名+描述的列表。使用 Ink 的 Box 和 Text 组件。选中项高亮（cyan），未选中项 dimColor。最多显示 5 项。命令名和描述之间用空格填充对齐。

- [ ] **Step 1: 创建组件**

Create `src/tui/components/CommandSuggestions.tsx`:

```typescript
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
```

- [ ] **Step 2: 验证类型检查**

```bash
bunx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/CommandSuggestions.tsx
git commit -m "feat(tui): add CommandSuggestions component for command autocomplete"
```

---

## Task 4: 在 PromptInput 中集成自动提示

**Files:**
- Modify: `src/tui/components/PromptInput.tsx`

**Context:** 在现有 PromptInput 中添加：
1. `commands` prop（接收可用命令列表）
2. `suggestions` 状态（items, selectedIndex, visible）
3. 输入监听：以 `/` 开头且不含空格时生成建议
4. 键盘处理：↑/↓ 循环选择，Tab 应用不执行，Enter 应用并执行，Escape 关闭
5. 渲染 CommandSuggestions 组件在输入框下方

**注意：** 保持现有键盘处理逻辑不变，在原有基础上添加 suggestion 相关处理。↑/↓ 在 suggestion 可见时优先控制 suggestion 选择，否则保持原有历史记录导航行为。

- [ ] **Step 1: 添加 imports 和类型**

在 `src/tui/components/PromptInput.tsx` 顶部添加：

```typescript
import type { Command } from "../../commands/types.js";
import { CommandSuggestions, type SuggestionItem } from "./CommandSuggestions.js";
import Fuse from "fuse.js";
```

修改 PromptInputProps 接口，添加 `commands` prop：

```typescript
export interface PromptInputProps {
  /** 是否禁用提交 */
  disabled?: boolean;
  /** 提交回调 */
  onSubmit: (text: string) => void;
  /** 执行 slash 命令回调 */
  onCommand: (command: string) => boolean | Promise<boolean>;
  /** 可用命令列表（用于自动提示） */
  commands?: Command[];
}
```

- [ ] **Step 2: 添加 suggestion 状态**

在 PromptInput 函数内部，现有 state 下方添加：

```typescript
  const [suggestions, setSuggestions] = React.useState<SuggestionItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = React.useState(0);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
```

- [ ] **Step 3: 添加命令过滤逻辑**

在 PromptInput 函数内部添加辅助函数：

```typescript
  const filterCommands = React.useCallback((inputText: string, availableCommands: Command[] = []): SuggestionItem[] => {
    const query = inputText.slice(1).toLowerCase().trim();
    
    if (query === "") {
      // 显示所有非隐藏命令
      return availableCommands
        .filter(cmd => !cmd.isHidden)
        .map(cmd => ({
          id: cmd.name,
          displayText: `/${cmd.name}`,
          description: cmd.description,
        }));
    }

    // 使用 Fuse.js 模糊匹配
    const fuse = new Fuse(availableCommands.filter(cmd => !cmd.isHidden), {
      keys: [
        { name: "name", weight: 3 },
        { name: "aliases", weight: 2 },
        { name: "description", weight: 0.5 },
      ],
      threshold: 0.3,
      includeScore: true,
    });

    const results = fuse.search(query);
    return results.map(result => ({
      id: result.item.name,
      displayText: `/${result.item.name}`,
      description: result.item.description,
    }));
  }, []);
```

- [ ] **Step 4: 在输入变化时更新建议**

在 useInput 回调开始前（在函数内部合适位置）添加 effect：

```typescript
  // 当输入变化时更新建议列表
  React.useEffect(() => {
    const text = lines.join("\n");
    if (text.startsWith("/") && !text.includes(" ") && commands && commands.length > 0) {
      const items = filterCommands(text, commands);
      setSuggestions(items);
      setShowSuggestions(items.length > 0);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  }, [lines, commands, filterCommands]);
```

- [ ] **Step 5: 修改键盘处理逻辑**

在现有的 useInput 回调中，修改以下按键处理：

**↑ 键处理**（在 `if (key.upArrow)` 代码块开头添加）：

```typescript
    if (key.upArrow) {
      // 如果建议列表可见，优先控制建议选择
      if (showSuggestions && suggestions.length > 0) {
        setSelectedSuggestion(prev => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
      // 原有历史记录导航逻辑...
```

**↓ 键处理**（在 `if (key.downArrow)` 代码块开头添加）：

```typescript
    if (key.downArrow) {
      // 如果建议列表可见，优先控制建议选择
      if (showSuggestions && suggestions.length > 0) {
        setSelectedSuggestion(prev => (prev >= suggestions.length - 1 ? 0 : prev + 1));
        return;
      }
      // 原有历史记录导航逻辑...
```

**Tab 键处理**（在 return key 处理之后添加新分支）：

```typescript
    if (key.tab) {
      if (showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedSuggestion];
        if (selected) {
          const newText = selected.displayText + " ";
          setLines([newText]);
          setCursorLine(0);
          setCursorCol(newText.length);
          setShowSuggestions(false);
        }
        return;
      }
    }
```

**Enter 键处理**（修改现有 return key 处理，在提交前检查建议）：

在现有的 `if (key.return)` 代码块中，在 `const text = lines.join("\n").trim();` 之后添加：

```typescript
      // 如果有选中的建议，应用并执行
      if (showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedSuggestion];
        if (selected) {
          const commandText = selected.displayText;
          setShowSuggestions(false);
          setLines([""]);
          setCursorLine(0);
          setCursorCol(0);
          
          // 执行命令
          void (async () => {
            if (commandText.startsWith("/")) {
              const handled = await onCommand(commandText);
              if (handled) return;
            }
            onSubmit(commandText);
          })();
          return;
        }
      }
```

**Escape 键处理**（修改现有 escape 处理）：

```typescript
    if (key.escape || (key.ctrl && input === "c")) {
      // 如果有建议列表，先关闭它
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }
      process.exit(0);
      return;
    }
```

- [ ] **Step 6: 渲染建议列表**

在 PromptInput 的 return 语句中，在 `</Box>` 之前添加：

```tsx
      {showSuggestions && (
        <CommandSuggestions items={suggestions} selectedIndex={selectedSuggestion} />
      )}
```

- [ ] **Step 7: 修改 PromptInput 接收 commands prop**

修改函数签名：

```typescript
export function PromptInput({ disabled, onSubmit, onCommand, commands = [] }: PromptInputProps): React.ReactElement {
```

- [ ] **Step 8: 验证类型检查**

```bash
bunx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 9: Commit**

```bash
git add src/tui/components/PromptInput.tsx
git commit -m "feat(tui): integrate command autocomplete into PromptInput"
```

---

## Task 5: 修改 App 传递 commands

**Files:**
- Modify: `src/tui/app.tsx`

**Context:** 将 `COMMANDS` 数组从 `src/commands/index.ts` 导入并传递给 PromptInput 组件。

- [ ] **Step 1: 导入 COMMANDS**

在 `src/tui/app.tsx` 顶部添加：

```typescript
import { COMMANDS } from "../commands/index.js";
```

- [ ] **Step 2: 传递 commands prop**

修改 PromptInput 组件调用：

```tsx
      <PromptInput disabled={false} onSubmit={handleSubmit} onCommand={handleCommand} commands={COMMANDS} />
```

- [ ] **Step 3: 验证类型检查**

```bash
bunx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/tui/app.tsx
git commit -m "feat(tui): pass commands to PromptInput for autocomplete"
```

---

## Task 6: 运行 TUI 验证功能

**Files:**
- 无文件修改

- [ ] **Step 1: 启动 TUI**

```bash
bun run tui
```

- [ ] **Step 2: 测试 /help 命令**

输入 `/help`，验证输出包含所有命令：`exit`, `clear`, `tools`, `help`

- [ ] **Step 3: 测试自动提示**

1. 输入 `/`，验证显示命令列表
2. 输入 `/c`，验证只显示 `clear`
3. 按 `↑/↓`，验证循环选择
4. 按 `Tab`，验证应用命令到输入框（不执行）
5. 按 `Enter`，验证执行命令
6. 按 `Escape`，验证关闭列表

- [ ] **Step 4: Commit（如需要修复）**

如果有修复，commit：

```bash
git add -A
git commit -m "fix: address autocomplete edge cases"
```

---

## Spec 覆盖检查

| Spec 需求 | 对应 Task |
|-----------|-----------|
| `/help` 命令 | Task 2 |
| 输入 `/` 显示所有命令 | Task 4 |
| 输入 `/c` 过滤命令 | Task 4 |
| ↑/↓ 循环选择 | Task 4 |
| Tab 应用不执行 | Task 4 |
| Enter 应用并执行 | Task 4 |
| Escape 关闭列表 | Task 4 |
| 最多显示 5 项 | Task 3 |
| 选中项高亮 | Task 3 |
| Fuse.js 模糊匹配 | Task 4 |

---

## 类型一致性检查

- `SuggestionItem` 接口在 `CommandSuggestions.tsx` 中定义，在 `PromptInput.tsx` 中导入使用 ✅
- `Command` 类型从 `src/commands/types.js` 导入 ✅
- `PromptInputProps` 新增 `commands` 可选 prop ✅
- `fuse.js` 类型通过 npm 包自带 ✅
