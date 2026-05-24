# Markdown TUI 渲染系统实现计划

## 目标

为 ys-code 引入对标 claude-code-haha 的 Markdown 终端渲染能力，支持标题、代码块、列表、表格、链接等元素的友好展示。

采用**分阶段递进**策略，先解决 90% 场景的视觉体验，再逐步引入性能优化和复杂排版。

---

## 方案选型：分阶段递进（方案 B）

| 维度 | 第一阶段（当前 plan） | 第二阶段 | 第三阶段 |
|------|---------------------|---------|---------|
| 核心能力 | marked 解析 + ANSI 渲染 | Token 缓存 + Streaming 增量 | 完整表格自适应 |
| 表格 | 纯文本 fallback | 简化表格 | 列宽自适应、换行、vertical fallback |
| 性能优化 | 无 | LRU Cache（500 条）+ Fast Path | 维持 |
| 流式渲染 | 每次全量解析 | StreamingMarkdown 增量解析 | 维持 |
| 语法高亮 | 无 | 引入 cli-highlight | 维持 |

---

## 第一阶段详细设计

### 文件结构

```
src/tui/
  components/
    MessageItem.tsx          # 修改：text/assistant_start 类型接入 Markdown
    Markdown.tsx             # 新增：React 组件，接收字符串输出 Ink 节点
    MarkdownTable.tsx        # 新增：表格简化渲染（或 fallback）
  utils/
    markdown.ts              # 新增：formatToken 递归函数，token → ANSI 字符串
```

### 核心流程（中文伪代码）

#### 1. Markdown 组件渲染流程

```
函数 Markdown({ children: string }):
    1. 调用 configureMarked() 配置 marked（禁用删除线解析）
    2. 调用 marked.lexer(children) 将 markdown 字符串解析为 Token 数组
    3. 遍历 Token 数组:
       - 如果 token 类型是 "table":
         → 累计之前的非表格内容为一个 ANSI 字符串
         → flush 到 elements 数组（包装为 <Ansi> 组件）
         → 将当前 table token 传给 <MarkdownTable> 组件，加入 elements
       - 否则:
         → 调用 formatToken(token, theme) 转为 ANSI 字符串
         → 追加到 nonTableContent 缓冲区
    4. 遍历结束后，flush 剩余的 nonTableContent
    5. 返回 <Box flexDirection="column" gap={1}>{elements}</Box>
```

#### 2. formatToken 递归渲染（核心）

```
函数 formatToken(token, theme, listDepth=0, orderedListNumber=null, parent=null):
    根据 token.type 分发:

    case "heading":
        如果 depth === 1:
            返回 chalk.bold.italic.underline(子内容) + "\n\n"
        否则:
            返回 chalk.bold(子内容) + "\n\n"

    case "code":
        如果提供了 highlight 器且支持该语言:
            返回 highlight.highlight(token.text, { language }) + "\n"
        否则:
            返回 token.text + "\n"

    case "codespan":
        返回 theme.codeColor(token.text)  // 行内代码，用主题色

    case "strong":
        返回 chalk.bold(递归渲染子 tokens)

    case "em":
        返回 chalk.italic(递归渲染子 tokens)

    case "blockquote":
        对每个子行:
            如果行不为空:
                返回 "│ " + chalk.italic(行内容)
            否则:
                返回空行
        所有行用 "\n" 连接

    case "link":
        提取链接文本（递归渲染子 tokens）
        如果文本与 URL 不同:
            返回 createHyperlink(URL, 带样式的文本)  // OSC 8 超链接
        否则:
            返回 createHyperlink(URL)  // 只显示 URL

    case "list":
        遍历每个 item:
            调用 formatToken(item, theme, listDepth, ordered ? start + index : null, token)
        用 "" 连接所有项

    case "list_item":
        对每个子 token:
            前缀 = "  ".repeat(listDepth)
            如果是有序列表:
                编号 = getListNumber(listDepth, orderedListNumber) + ". "
            否则:
                编号 = "- "
            返回 前缀 + 编号 + 递归渲染内容

    case "paragraph":
        返回 递归渲染子 tokens + "\n"

    case "space":
        返回 "\n"

    case "table":
        // 第一阶段：简化处理，直接返回原始文本或基础表格
        返回 renderSimpleTable(token, theme)

    default:
        返回 ""  // 忽略不支持的 token
```

#### 3. MarkdownTable 简化渲染

```
函数 MarkdownTable({ token, highlight }):
    1. 提取表头：对 token.header 的每个单元格，调用 formatCell(tokens) 获取 ANSI 文本
    2. 提取所有行：对 token.rows 的每行每列，调用 formatCell(tokens)
    3. 计算每列最大宽度：
       对每列 i:
           maxWidth = max(所有行第 i 列的 visibleWidth, 表头第 i 列的 visibleWidth, 3)
    4. 构建输出:
       顶部边框: "┌─" + "─┬─".join(["─" * w for w in columnWidths]) + "─┐"
       表头行: "│ " + " │ ".join([padAligned(cell, width) for cell, width in zip(headerCells, columnWidths)]) + " │"
       分隔线: "├─" + "─┼─".join(["─" * w for w in columnWidths]) + "─┤"
       对每个数据行:
           "│ " + " │ ".join([padAligned(cell, width) for cell, width in zip(rowCells, columnWidths)]) + " │"
       底部边框: "└─" + "─┴─".join(["─" * w for w in columnWidths]) + "─┘"
    5. 所有行用 "\n" 连接，返回 <Ansi>{结果}</Ansi>

辅助函数 formatCell(tokens):
    返回 tokens.map(t => formatToken(t, theme)).join("")

辅助函数 padAligned(content, displayWidth, targetWidth, align='left'):
    padding = targetWidth - displayWidth
    如果 align === 'center':
        leftPad = floor(padding / 2)
        返回 " " * leftPad + content + " " * (padding - leftPad)
    否则如果 align === 'right':
        返回 " " * padding + content
    否则:
        返回 content + " " * padding
```

#### 4. MessageItem 集成

```
函数 MessageItem({ message }):
    switch message.type:
        case "text":
            返回:
                <Box flexDirection="column">
                    <Markdown>{message.text}</Markdown>
                </Box>

        case "thinking":
            返回:
                <Box flexDirection="column">
                    <Text dimColor>Thinking:</Text>
                    <Box paddingLeft={2}>
                        <Markdown dimColor>{message.text}</Markdown>
                    </Box>
                </Box>

        // 其他类型保持不变...
```

#### 5. 链接处理（OSC 8 超链接）

```
函数 createHyperlink(url, text?):
    如果终端不支持超链接:
        返回 text || url

    // OSC 8 格式: \e]8;;URL\e\\TEXT\e]8;;\e\\
    如果提供了 text:
        返回 "\x1b]8;;" + url + "\x1b\\" + text + "\x1b]8;;\x1b\\"
    否则:
        返回 "\x1b]8;;" + url + "\x1b\\" + url + "\x1b]8;;\x1b\\"
```

#### 6. Issue 引用自动链接（可选增强）

```
函数 linkifyIssueReferences(text):
    如果终端不支持超链接:
        返回 text

    正则匹配: /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g
    替换为: prefix + createHyperlink("https://github.com/" + repo + "/issues/" + num, repo + "#" + num)
```

### 依赖

已具备：
- `marked` (^18.0.1)：markdown 解析
- `chalk` (5.6.2)：ANSI 颜色
- `strip-ansi` (7.2.0)：去除 ANSI 计算可见宽度
- `wrap-ansi` (10.0.0)：ANSI 感知换行
- `ink` (^7.0.0)：TUI 框架

待评估引入：
- `cli-highlight`：代码语法高亮（第二阶段）

### 接口定义

```typescript
// src/tui/components/Markdown.tsx
interface MarkdownProps {
  children: string;
  /** 是否以 dim 颜色渲染所有文本 */
  dimColor?: boolean;
}

// src/tui/utils/markdown.ts
export function formatToken(
  token: Token,
  theme: ThemeName,
  listDepth?: number,
  orderedListNumber?: number | null,
  parent?: Token | null,
  highlight?: CliHighlight | null,
): string;

export function applyMarkdown(
  content: string,
  theme: ThemeName,
  highlight?: CliHighlight | null,
): string;
```

---

## 第二阶段计划（后续）

### 2.1 Token 缓存系统

```
全局变量:
    tokenCache = Map<string, Token[]>   // key: 内容 hash, value: tokens
    TOKEN_CACHE_MAX = 500

函数 cachedLexer(content):
    key = hashContent(content)

    如果 tokenCache 中存在 key:
        // 提升为 MRU（删除后重新插入，保持 Map 顺序）
        tokens = tokenCache.get(key)
        tokenCache.delete(key)
        tokenCache.set(key, tokens)
        返回 tokens

    tokens = marked.lexer(content)

    如果 tokenCache.size >= TOKEN_CACHE_MAX:
        // 淘汰最早的（Map 按插入顺序维护）
        firstKey = tokenCache.keys().next().value
        tokenCache.delete(firstKey)

    tokenCache.set(key, tokens)
    返回 tokens
```

### 2.2 Fast Path（纯文本短路）

```
常量 MD_SYNTAX_RE = /[#*`|>[\-_~]|\n\n|^\d+\. |\n\d+\. /

函数 hasMarkdownSyntax(text):
    sample = text.length > 500 ? text.slice(0, 500) : text
    返回 MD_SYNTAX_RE.test(sample)

函数 cachedLexer(content):
    如果 !hasMarkdownSyntax(content):
        // 快速返回单个 paragraph token，跳过完整解析
        返回 [{
            type: 'paragraph',
            raw: content,
            text: content,
            tokens: [{ type: 'text', raw: content, text: content }]
        }]

    // 否则走正常缓存逻辑...
```

### 2.3 StreamingMarkdown 增量解析

```
函数 StreamingMarkdown({ children: string }):
    stripped = stripPromptXMLTags(children)
    stablePrefixRef = useRef('')

    // 如果文本被替换（非增量），重置稳定前缀
    如果 !stripped.startsWith(stablePrefixRef.current):
        stablePrefixRef.current = ''

    boundary = stablePrefixRef.current.length
    tokens = marked.lexer(stripped.substring(boundary))

    // 最后一个非空 token 是不稳定的（正在增长）
    lastContentIdx = tokens.length - 1
    当 lastContentIdx >= 0 且 tokens[lastContentIdx].type === 'space':
        lastContentIdx--

    // 计算稳定前缀应前进多少
    advance = 0
    对 i 从 0 到 lastContentIdx - 1:
        advance += tokens[i].raw.length

    如果 advance > 0:
        stablePrefixRef.current = stripped.substring(0, boundary + advance)

    stablePrefix = stablePrefixRef.current
    unstableSuffix = stripped.substring(stablePrefix.length)

    返回:
        <Box flexDirection="column" gap={1}>
            {stablePrefix 存在 && <Markdown>{stablePrefix}</Markdown>}
            {unstableSuffix 存在 && <Markdown>{unstableSuffix}</Markdown>}
        </Box>
        // 说明：stablePrefix 在 Markdown 内部被 useMemo 缓存，不会重复解析
```

---

## 第三阶段计划（后续）

### 3.1 完整 MarkdownTable

```
函数 MarkdownTable({ token, highlight, forceWidth? }):
    terminalWidth = forceWidth || useTerminalSize().columns

    // 步骤 1: 计算每列的最小宽度（最长单词）和理想宽度（完整内容）
    minWidths = token.header.map((h, colIdx) => {
        max(h.tokens, token.rows 每行第 colIdx 列).map(getMinWidth).max()
    })
    idealWidths = token.header.map((h, colIdx) => {
        max(h.tokens, token.rows 每行第 colIdx 列).map(getIdealWidth).max()
    })

    // 步骤 2: 计算可用空间
    numCols = token.header.length
    borderOverhead = 1 + numCols * 3   // 边框字符开销
    availableWidth = terminalWidth - borderOverhead - SAFETY_MARGIN

    // 步骤 3: 列宽分配策略
    如果 totalIdeal <= availableWidth:
        columnWidths = idealWidths                    // 全部用理想宽度
    否则如果 totalMin <= availableWidth:
        // 给每列最小宽度，剩余空间按溢出比例分配
        extraSpace = availableWidth - totalMin
        overflows = idealWidths.map((ideal, i) => ideal - minWidths[i])
        columnWidths = minWidths.map((min, i) => min + floor(overflows[i] / totalOverflow * extraSpace))
    否则:
        // 连最小宽度都超了，按比例压缩，允许断词
        needsHardWrap = true
        scaleFactor = availableWidth / totalMin
        columnWidths = minWidths.map(w => max(floor(w * scaleFactor), MIN_COLUMN_WIDTH))

    // 步骤 4: 判断是否转 vertical 格式
    maxRowLines = 计算所有单元格换行后的最大行数
    如果 maxRowLines > MAX_ROW_LINES:
        返回 renderVerticalFormat()   // key-value 对格式

    // 步骤 5: 渲染水平表格
    tableLines = [
        renderBorderLine('top'),
        ...renderRowLines(token.header, isHeader=true),
        renderBorderLine('middle'),
        ...token.rows.flatMap((row, idx) => [
            ...renderRowLines(row, isHeader=false),
            idx < token.rows.length - 1 ? renderBorderLine('middle') : []
        ]),
        renderBorderLine('bottom')
    ]

    // 安全边距检查
    maxLineWidth = max(tableLines.map(line => stringWidth(stripAnsi(line))))
    如果 maxLineWidth > terminalWidth - SAFETY_MARGIN:
        返回 renderVerticalFormat()   // resize 后回退

    返回 <Ansi>{tableLines.join('\n')}</Ansi>
```

---

## 测试策略

### 第一阶段测试用例

1. **基础文本**：纯文本段落正常显示
2. **标题**：`# h1`, `## h2`, `### h3` 分别有加粗、下划线效果
3. **行内样式**：`**粗体**`, `*斜体*`, `` `代码` ``
4. **代码块**：带语言标识的 fence code，有边框或背景色区分
5. **列表**：有序/无序列表，嵌套列表缩进正确
6. **引用块**：`> quote` 有左边框竖线
7. **链接**：URL 可点击（OSC 8），文字链接显示文字+URL
8. **表格**：简单表格有边框对齐

### 第二阶段测试用例

1. **缓存命中**：相同内容重复渲染从缓存读取
2. **Fast Path**：无 markdown 语法的文本不走 `marked.lexer`
3. **Streaming**：流式输出时稳定前缀不闪烁、不重复解析

---

## 时间估算

| 阶段 | 任务 | 预估 |
|------|------|------|
| 一 | markdown.ts + Markdown.tsx + MarkdownTable.tsx | 4-6h |
| 一 | MessageItem 集成 + 测试 | 2h |
| 二 | Token Cache + Fast Path + StreamingMarkdown | 3-4h |
| 二 | 集成测试 | 1-2h |
| 三 | 完整 MarkdownTable + vertical fallback | 4-6h |

---

## 风险与备选

| 风险 | 影响 | 备选方案 |
|------|------|---------|
| `marked` v18 与 cc 使用的版本行为差异 | 解析结果不一致 | 锁定 `marked` 版本，或升级至 cc 相同版本 |
| 表格渲染在窄终端溢出 | 布局错乱 | 第一阶段先限制表格最小宽度，超宽时 fallback 原始文本 |
| ANSI 颜色与 Ink `<Text color>` 冲突 | 颜色显示异常 | 确保 `<Ansi>` 组件正确处理 ANSI 转义序列 |
