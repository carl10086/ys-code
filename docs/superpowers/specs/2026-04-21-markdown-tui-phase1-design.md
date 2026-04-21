# Markdown TUI 渲染 第一阶段设计

## 目标

让 ys-code 的终端消息展示支持 Markdown 基础元素：标题、代码、列表、引用、链接、表格。对标 claude-code-haha 的视觉体验。

本阶段范围限定为**基础 ANSI 渲染**，不包含缓存、流式增量、语法高亮。这些将在第二阶段引入。

---

## 架构

采用**混合渲染策略**（与 cc 一致）：

- **非表格内容**：通过 `formatToken` 转为 ANSI 转义序列字符串，由 `<Ansi>` 组件输出
- **表格内容**：独立 `<MarkdownTable>` React 组件，用边框字符绘制对齐表格

原因：表格需要精确计算列宽和边框字符，React 组件比纯 ANSI 字符串更易维护；其他元素用 ANSI 字符串更轻量。

---

## 文件结构

修改 4 个文件，无新增依赖：

```
src/tui/
  components/
    MessageItem.tsx          # 修改：text/thinking 接入 Markdown
    Markdown.tsx             # 新增：混合渲染入口
    MarkdownTable.tsx        # 新增：简单表格渲染
  utils/
    markdown.ts              # 新增：formatToken 递归，token → ANSI
```

---

## 组件设计

### 1. markdown.ts

**职责**：将 marked Token 递归转换为 ANSI 字符串。

**核心函数**：

- `formatToken(token, theme, listDepth, orderedListNumber, parent, highlight?) → string`
- `applyMarkdown(content, theme) → string`：对外入口，负责 lexer + 遍历

**支持的 token 类型**：

| 类型 | 渲染行为 |
|------|---------|
| heading | h1 加粗+斜体+下划线，其他层级仅加粗，尾部加换行 |
| code | 代码块，暂不高亮，保留原始文本 + 换行 |
| codespan | 行内代码，主题色（默认 cyan） |
| strong | chalk.bold |
| em | chalk.italic |
| blockquote | 每行前加 `│ `，空行保留 |
| link | OSC 8 超链接（终端支持则可点击） |
| list / list_item | 无序列表用 `- `，有序用 `1. `，支持嵌套缩进 |
| paragraph | 递归子 token + `\n` |
| space | `\n` |
| table | 返回空字符串（由 Markdown.tsx 单独处理） |

**主题**：`ThemeName` 枚举（`light` | `dark`），默认 `dark`。`codeColor` 等样式函数根据主题返回 chalk 实例。

### 2. Markdown.tsx

**Props**：

```typescript
interface MarkdownProps {
  /** 要渲染的 Markdown 字符串 */
  children: string;
  /** 是否以 dim 颜色渲染所有文本 */
  dimColor?: boolean;
}
```

**渲染流程**：

1. 调用 `marked.lexer(children)` 解析为 Token 数组
2. 遍历 Token：
   - 遇 `table` token：flush 之前的非表格内容为 `<Ansi>` 元素，然后将 `<MarkdownTable>` 加入 elements
   - 其他 token：追加到 `nonTableContent` 字符串
3. 遍历结束后 flush 剩余 `nonTableContent`
4. 返回 `<Box flexDirection="column" gap={1}>{elements}</Box>`

**说明**：`<Ansi>` 组件需正确处理 ANSI 转义序列（ink 支持 raw ANSI 输出）。若 ink 不直接支持，可用 `<Text>` 配合 `chalk` 生成带样式的字符串。

### 3. MarkdownTable.tsx

**Props**：

```typescript
interface MarkdownTableProps {
  /** marked 解析出的表格 token */
  token: Tokens.Table;
  /** 主题名称 */
  theme: ThemeName;
}
```

**渲染流程**：

1. 提取表头和数据行的单元格文本（通过 `formatCell`，即对每个单元格的 tokens 调用 `formatToken`）
2. 计算每列最大宽度：`max(表头宽度, 所有行该列宽度, 3)`
3. 用边框字符绘制表格：
   - 顶部：`┌─┬─┐`
   - 表头行：`│ 内容 │`
   - 分隔线：`├─┼─┤`
   - 数据行：`│ 内容 │`
   - 底部：`└─┴─┘`
4. 所有行用 `\n` 连接，外层包 `<Text>`（或 `<Ansi>`）输出

**对齐**：默认左对齐，遵循 token 中记录的 `align` 属性（`left` | `center` | `right`）。

**超宽处理**：如果表格总宽度超过终端宽度减去安全边距（`terminalWidth - SAFETY_MARGIN`），则 fallback 为纯文本输出（保留 markdown 原始格式）。

### 4. MessageItem.tsx 集成

修改两处：

- `case "text"`：`<Text bold>Answer:</Text>` 下方改为 `<Markdown>{message.text}</Markdown>`
- `case "thinking"`：`<Text dimColor>Thinking:</Text>` 下方的 `<Text dimColor>` 改为 `<Markdown dimColor>`

其余 case 保持不变。

---

## 数据流

```
message.text
    ↓
marked.lexer() → Token[]
    ↓
Markdown.tsx 遍历 Token[]
    ├─ table token → MarkdownTable.tsx（Box/Text 绘制边框）
    └─ 其他 token → formatToken() → ANSI 字符串 → <Ansi>
    ↓
Ink 渲染到终端
```

---

## 依赖

已具备，无需新增：

- `marked` (^18.0.1)：markdown 解析
- `chalk` (5.6.2)：ANSI 颜色
- `strip-ansi` (7.2.0)：计算可见宽度（表格列宽用）
- `ink` (^7.0.0)：TUI 框架

---

## 测试策略

本阶段需覆盖 8 个场景：

1. **纯文本段落**：无 markdown 语法，正常显示
2. **标题**：`# h1` 有下划线+加粗+斜体，`## h2` 有加粗
3. **行内样式**：`**粗体**`、`*斜体*`、`` `代码` ``
4. **代码块**：fence code 保留格式
5. **列表**：无序 `- `、有序 `1. `，嵌套缩进正确
6. **引用块**：`> quote` 左侧有 `│ ` 竖线
7. **链接**：OSC 8 超链接格式正确（终端支持时可点击）
8. **表格**：简单表格有边框，列宽对齐，超宽时 fallback

测试方式：为 `formatToken` 和 `MarkdownTable` 编写单元测试，输入 markdown 字符串，断言输出包含预期的 ANSI 序列或边框字符。

---

## 风险与备选

| 风险 | 应对 |
|------|------|
| `marked` v18 与 cc 使用的版本行为差异 | 先按 v18 实现，遇到解析差异再调整 |
| 表格在窄终端溢出 | 超宽时 fallback 为原始文本 |
| ANSI 与 Ink `<Text color>` 冲突 | 确保使用 `<Text>` 的 `color` 属性时不与 chalk 生成的 ANSI 重叠；表格用 `<Text>` 输出边框字符，单元格内容用 chalk 着色 |
