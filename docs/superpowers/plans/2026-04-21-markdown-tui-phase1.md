# Markdown TUI 第一阶段实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ys-code TUI 引入基础 Markdown ANSI 渲染能力，支持标题、代码、列表、引用、链接、表格，对标 claude-code-haha 视觉体验。

**Architecture:** 采用混合渲染策略——非表格内容转为 ANSI 字符串输出，表格使用独立 React 组件绘制边框对齐。基于 marked lexer 解析 + chalk 着色 + Ink 组件渲染。

**Tech Stack:** TypeScript, Bun, marked, chalk, strip-ansi, ink, React

**Code Style:** 定义结构体优先用 `interface`，字段要有中文注释。保持简洁，不引入未请求的抽象。

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/tui/utils/markdown.ts` | 创建 | formatToken 递归渲染，token → ANSI 字符串 |
| `src/tui/components/MarkdownTable.tsx` | 创建 | 简单表格渲染，边框字符对齐 |
| `src/tui/components/Markdown.tsx` | 创建 | 混合渲染入口，分流 table 与非 table token |
| `src/tui/components/MessageItem.tsx` | 修改 | text/thinking case 接入 Markdown 组件 |

---

## Task 1: markdown.ts 核心渲染函数

**Files:**
- Create: `src/tui/utils/markdown.ts`
- Test: `src/tui/utils/markdown.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from "bun:test";
import { formatToken, applyMarkdown } from "./markdown.js";
import type { Token } from "marked";

describe("formatToken", () => {
  it("renders heading with bold", () => {
    const token: Token = {
      type: "heading",
      depth: 2,
      text: "Hello",
      raw: "## Hello",
      tokens: [{ type: "text", raw: "Hello", text: "Hello" }],
    } as Token;
    const result = formatToken(token, "dark");
    expect(result).toContain("\x1b[1m"); // bold ANSI
    expect(result).toContain("Hello");
  });

  it("renders codespan with theme color", () => {
    const token: Token = {
      type: "codespan",
      raw: "`code`",
      text: "code",
    } as Token;
    const result = formatToken(token, "dark");
    expect(result).toContain("code");
    expect(result).not.toBe("code"); // should have ANSI styling
  });

  it("renders paragraph with newline", () => {
    const token: Token = {
      type: "paragraph",
      raw: "Hello world",
      text: "Hello world",
      tokens: [{ type: "text", raw: "Hello world", text: "Hello world" }],
    } as Token;
    const result = formatToken(token, "dark");
    expect(result).toContain("Hello world");
    expect(result).toContain("\n");
  });
});

describe("applyMarkdown", () => {
  it("renders basic markdown string", () => {
    const result = applyMarkdown("## Hello\n\nThis is a **test**.", "dark");
    expect(result).toContain("Hello");
    expect(result).toContain("test");
    expect(result).toContain("\x1b[1m"); // bold for heading and strong
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/tui/utils/markdown.test.ts`
Expected: FAIL — `formatToken` 和 `applyMarkdown` 未定义

- [ ] **Step 3: 实现最小代码**

```typescript
// src/tui/utils/markdown.ts
import chalk from "chalk";
import { marked, type Token } from "marked";
import stripAnsi from "strip-ansi";

/** 主题名称 */
export type ThemeName = "light" | "dark";

/** 获取主题对应的 chalk 实例 */
function getTheme(theme: ThemeName): chalk.Chalk {
  return theme === "light" ? chalk : chalk;
}

/** 获取代码颜色 */
function codeColor(theme: ThemeName): chalk.Chalk {
  return theme === "light" ? chalk.cyan : chalk.cyan;
}

/** 创建 OSC 8 超链接
 * @param url 链接地址
 * @param text 显示文本
 */
function createHyperlink(url: string, text?: string): string {
  const display = text || url;
  // OSC 8 格式: \e]8;;URL\e\\TEXT\e]8;;\e\\
  return `\x1b]8;;${url}\x1b\\${display}\x1b]8;;\x1b\\`;
}

/** 计算字符串的可见宽度（去除 ANSI 后长度）
 * @param str 可能包含 ANSI 的字符串
 */
export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/** 对内容进行填充对齐
 * @param content 内容字符串
 * @param targetWidth 目标可见宽度
 * @param align 对齐方式
 */
export function padAligned(
  content: string,
  targetWidth: number,
  align: "left" | "center" | "right" = "left",
): string {
  const width = visibleWidth(content);
  const padding = targetWidth - width;
  if (padding <= 0) return content;

  if (align === "center") {
    const leftPad = Math.floor(padding / 2);
    return " ".repeat(leftPad) + content + " ".repeat(padding - leftPad);
  }
  if (align === "right") {
    return " ".repeat(padding) + content;
  }
  return content + " ".repeat(padding);
}

/** 格式化单个 token 为 ANSI 字符串
 * @param token marked 解析出的 token
 * @param theme 主题名称
 * @param listDepth 列表嵌套深度
 * @param orderedListNumber 有序列表当前编号
 * @param parent 父 token
 */
export function formatToken(
  token: Token,
  theme: ThemeName = "dark",
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
): string {
  const t = getTheme(theme);

  switch (token.type) {
    case "heading": {
      const text = token.tokens?.map((child) => formatToken(child, theme)).join("") || "";
      if (token.depth === 1) {
        return t.bold.italic.underline(text) + "\n\n";
      }
      return t.bold(text) + "\n\n";
    }

    case "code": {
      return token.text + "\n";
    }

    case "codespan": {
      return codeColor(theme)(token.text);
    }

    case "strong": {
      const text = token.tokens?.map((child) => formatToken(child, theme)).join("") || "";
      return t.bold(text);
    }

    case "em": {
      const text = token.tokens?.map((child) => formatToken(child, theme)).join("") || "";
      return t.italic(text);
    }

    case "blockquote": {
      const lines = (token.tokens || []).map((child) => {
        const line = formatToken(child, theme);
        if (!line.trim()) return "";
        return "│ " + t.italic(line.trim());
      });
      return lines.join("\n") + "\n";
    }

    case "link": {
      const text = token.tokens?.map((child) => formatToken(child, theme)).join("") || "";
      if (text && text !== token.href) {
        return createHyperlink(token.href, text);
      }
      return createHyperlink(token.href);
    }

    case "list": {
      const items = (token.items || []).map((item: Token, index: number) => {
        const number = token.ordered ? (token.start || 1) + index : null;
        return formatToken(item, theme, listDepth, number, token);
      });
      return items.join("");
    }

    case "list_item": {
      const indent = "  ".repeat(listDepth);
      const prefix = orderedListNumber !== null ? `${orderedListNumber}. ` : "- ";
      const content = (token.tokens || [])
        .map((child) => formatToken(child, theme, listDepth + 1, null, token))
        .join("")
        .trim();
      return indent + prefix + content + "\n";
    }

    case "paragraph": {
      const text = token.tokens?.map((child) => formatToken(child, theme)).join("") || "";
      return text + "\n";
    }

    case "space": {
      return "\n";
    }

    case "table": {
      // 表格由 MarkdownTable 单独处理
      return "";
    }

    case "text": {
      return token.text || "";
    }

    default:
      return "";
  }
}

/** 将 markdown 字符串转为 ANSI 字符串
 * @param content markdown 内容
 * @param theme 主题名称
 */
export function applyMarkdown(content: string, theme: ThemeName = "dark"): string {
  const tokens = marked.lexer(content);
  return tokens.map((token) => formatToken(token as Token, theme)).join("");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/tui/utils/markdown.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tui/utils/markdown.ts src/tui/utils/markdown.test.ts
git commit -m "feat(markdown): 核心 ANSI 渲染函数

支持 heading、code、codespan、strong、em、
blockquote、link、list、paragraph、space。

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 2: MarkdownTable 表格组件

**Files:**
- Create: `src/tui/components/MarkdownTable.tsx`
- Test: `src/tui/components/MarkdownTable.test.tsx`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { MarkdownTable } from "./MarkdownTable.js";
import type { Tokens } from "marked";

describe("MarkdownTable", () => {
  it("renders table with borders", () => {
    const token: Tokens.Table = {
      type: "table",
      raw: "| A | B |\n|---|---|\n| 1 | 2 |",
      header: [
        { text: "A", tokens: [{ type: "text", raw: "A", text: "A" }], align: null },
        { text: "B", tokens: [{ type: "text", raw: "B", text: "B" }], align: null },
      ],
      rows: [
        [
          { text: "1", tokens: [{ type: "text", raw: "1", text: "1" }], align: null },
          { text: "2", tokens: [{ type: "text", raw: "2", text: "2" }], align: null },
        ],
      ],
      align: [null, null],
    };

    const { lastFrame } = render(<MarkdownTable token={token} theme="dark" />);
    expect(lastFrame()).toContain("┌─");
    expect(lastFrame()).toContain("─┬─");
    expect(lastFrame()).toContain("│ A");
    expect(lastFrame()).toContain("│ 1");
    expect(lastFrame()).toContain("└─");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/tui/components/MarkdownTable.test.tsx`
Expected: FAIL — `MarkdownTable` 未定义

- [ ] **Step 3: 实现最小代码**

```typescript
// src/tui/components/MarkdownTable.tsx
import { Box, Text } from "ink";
import React from "react";
import type { Tokens } from "marked";
import { formatToken, visibleWidth, padAligned, type ThemeName } from "../utils/markdown.js";

/** MarkdownTable 组件属性 */
interface MarkdownTableProps {
  /** marked 解析出的表格 token */
  token: Tokens.Table;
  /** 主题名称 */
  theme: ThemeName;
}

/** 格式化单元格内容
 * @param tokens 单元格内的 token 数组
 * @param theme 主题名称
 */
function formatCell(tokens: Token[], theme: ThemeName): string {
  return tokens.map((t) => formatToken(t, theme)).join("");
}

/** 安全边距（终端宽度减去此值作为表格最大宽度） */
const SAFETY_MARGIN = 4;

/** 最小列宽 */
const MIN_COLUMN_WIDTH = 3;

export function MarkdownTable({ token, theme }: MarkdownTableProps): React.ReactElement {
  // 提取表头文本
  const headerCells = token.header.map((h) => formatCell(h.tokens, theme));

  // 提取数据行文本
  const rowCells = token.rows.map((row) => row.map((cell) => formatCell(cell.tokens, theme)));

  // 计算每列最大宽度
  const columnWidths = headerCells.map((header, colIdx) => {
    const headerWidth = visibleWidth(header);
    const maxRowWidth = Math.max(
      ...rowCells.map((row) => visibleWidth(row[colIdx])),
      0,
    );
    return Math.max(headerWidth, maxRowWidth, MIN_COLUMN_WIDTH);
  });

  const totalWidth =
    columnWidths.reduce((sum, w) => sum + w, 0) + (columnWidths.length + 1) * 3 - 2;

  // 超宽 fallback：直接输出原始 markdown
  if (totalWidth > process.stdout.columns - SAFETY_MARGIN) {
    return (
      <Box flexDirection="column">
        <Text>{token.raw}</Text>
      </Box>
    );
  }

  // 构建边框
  const topBorder =
    "┌─" + columnWidths.map((w) => "─".repeat(w)).join("─┬─") + "─┐";
  const separator =
    "├─" + columnWidths.map((w) => "─".repeat(w)).join("─┼─") + "─┤";
  const bottomBorder =
    "└─" + columnWidths.map((w) => "─".repeat(w)).join("─┴─") + "─┘";

  // 构建表头行
  const headerRow =
    "│ " +
    headerCells
      .map((cell, i) => padAligned(cell, columnWidths[i], token.align?.[i] || "left"))
      .join(" │ ") +
    " │";

  // 构建数据行
  const dataRows = rowCells.map((row) =>
    "│ " +
    row
      .map((cell, i) => padAligned(cell, columnWidths[i], token.align?.[i] || "left"))
      .join(" │ ") +
    " │",
  );

  // 组装所有行
  const lines = [topBorder, headerRow, separator, ...dataRows, bottomBorder];

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/tui/components/MarkdownTable.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tui/components/MarkdownTable.tsx src/tui/components/MarkdownTable.test.tsx
git commit -m "feat(MarkdownTable): 简单表格带边框渲染

支持列宽计算、对齐、超宽 fallback。

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Markdown 混合渲染组件

**Files:**
- Create: `src/tui/components/Markdown.tsx`
- Test: `src/tui/components/Markdown.test.tsx`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { Markdown } from "./Markdown.js";

describe("Markdown", () => {
  it("renders heading and text", () => {
    const { lastFrame } = render(<Markdown>## Hello\n\nWorld</Markdown>);
    expect(lastFrame()).toContain("Hello");
    expect(lastFrame()).toContain("World");
  });

  it("renders table", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |";
    const { lastFrame } = render(<Markdown>{input}</Markdown>);
    expect(lastFrame()).toContain("┌─");
    expect(lastFrame()).toContain("│ A");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/tui/components/Markdown.test.tsx`
Expected: FAIL — `Markdown` 未定义

- [ ] **Step 3: 实现最小代码**

```typescript
// src/tui/components/Markdown.tsx
import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { marked, type Token } from "marked";
import { formatToken, type ThemeName } from "../utils/markdown.js";
import { MarkdownTable } from "./MarkdownTable.js";

/** Markdown 组件属性 */
interface MarkdownProps {
  /** 要渲染的 Markdown 字符串 */
  children: string;
  /** 是否以 dim 颜色渲染所有文本 */
  dimColor?: boolean;
}

/** 配置 marked（禁用删除线解析等） */
function configureMarked(): void {
  marked.use({
    tokenizer: {
      // 禁用删除线
      del() {
        return undefined;
      },
    },
  });
}

configureMarked();

export function Markdown({ children, dimColor }: MarkdownProps): React.ReactElement {
  const elements = useMemo(() => {
    const tokens = marked.lexer(children);
    const result: React.ReactNode[] = [];
    let nonTableContent = "";

    /** 将累计的非表格内容 flush 为 Text 元素 */
    function flushNonTableContent() {
      if (nonTableContent) {
        result.push(
          <Text key={result.length} dimColor={dimColor}>
            {nonTableContent}
          </Text>,
        );
        nonTableContent = "";
      }
    }

    for (const token of tokens) {
      if (token.type === "table") {
        flushNonTableContent();
        result.push(
          <MarkdownTable
            key={result.length}
            token={token as Tokens.Table}
            theme={dimColor ? "dark" : "dark"}
          />,
        );
      } else {
        nonTableContent += formatToken(token as Token, dimColor ? "dark" : "dark");
      }
    }

    flushNonTableContent();
    return result;
  }, [children, dimColor]);

  return (
    <Box flexDirection="column" gap={1}>
      {elements}
    </Box>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/tui/components/Markdown.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tui/components/Markdown.tsx src/tui/components/Markdown.test.tsx
git commit -m "feat(Markdown): 混合渲染组件

分流 table token 到 MarkdownTable，
其他 token 转为 ANSI 字符串通过 Text 输出。

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 4: MessageItem 接入 Markdown

**Files:**
- Modify: `src/tui/components/MessageItem.tsx`

- [ ] **Step 1: 修改 MessageItem.tsx**

修改两处：

1. 顶部引入 Markdown 组件：

```typescript
import { Markdown } from "./Markdown.js";
```

2. 修改 `case "text"`（约第 43-48 行）：

```tsx
case "text":
  return (
    <Box flexDirection="column">
      <Text bold>Answer:</Text>
      <Markdown>{message.text}</Markdown>
    </Box>
  );
```

3. 修改 `case "thinking"`（约第 34-41 行）：

```tsx
case "thinking":
  return (
    <Box flexDirection="column">
      <Text dimColor>Thinking:</Text>
      <Box paddingLeft={2}>
        <Markdown dimColor>{message.text}</Markdown>
      </Box>
    </Box>
  );
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: PASS（无类型错误）

- [ ] **Step 3: 运行测试**

Run: `bun test`
Expected: PASS（所有现有测试通过）

- [ ] **Step 4: 提交**

```bash
git add src/tui/components/MessageItem.tsx
git commit -m "feat(MessageItem): text/thinking 接入 Markdown 渲染

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 5: 集成验证

**Files:**
- 无需修改文件，手动验证

- [ ] **Step 1: 启动 TUI 并观察**

Run: `bun run tui`

输入一条包含多种 markdown 元素的消息，观察渲染效果：

```
## 测试标题

这是一段**粗体**和*斜体*文本，还有`行内代码`。

- 无序列表项 1
- 无序列表项 2

1. 有序列表项 1
2. 有序列表项 2

> 这是一段引用

| 列A | 列B |
|-----|-----|
| 1   | 2   |
| 3   | 4   |
```

- [ ] **Step 2: 验证清单**

检查终端输出：
- [ ] 标题有加粗效果
- [ ] 粗体、斜体、行内代码有样式区分
- [ ] 无序列表有 `- ` 前缀，有序列表有 `1. ` 前缀
- [ ] 引用块左侧有 `│ ` 竖线
- [ ] 表格有边框线（`┌─┬─┐` 等），列宽对齐
- [ ] 无报错，无类型错误

- [ ] **Step 3: 提交（如有调整）**

若验证中发现问题并修复，单独提交修复。若一切正常，无需额外提交。

---

## Self-Review 检查表

### Spec Coverage

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 支持 heading | Task 1 |
| 支持 code/codespan | Task 1 |
| 支持 strong/em | Task 1 |
| 支持 blockquote | Task 1 |
| 支持 link (OSC 8) | Task 1 |
| 支持 list/list_item | Task 1 |
| 支持 paragraph/space | Task 1 |
| 表格边框渲染 | Task 2 |
| 混合渲染（table 分流） | Task 3 |
| MessageItem 集成 | Task 4 |
| 手动验证 | Task 5 |

### Placeholder Scan

- [x] 无 "TBD" / "TODO" / "implement later"
- [x] 无 "add appropriate error handling"
- [x] 每步都有具体代码或命令
- [x] 无 "Similar to Task N" 引用

### Type Consistency

- [x] `ThemeName` 在 Task 1 定义，Task 2/3 导入使用
- [x] `formatToken` 签名在 Task 1 定义，Task 2 调用
- [x] `MarkdownProps` 在 Task 3 定义，与 spec 一致
- [x] `MarkdownTableProps` 在 Task 2 定义，与 spec 一致

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-04-21-markdown-tui-phase1.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
