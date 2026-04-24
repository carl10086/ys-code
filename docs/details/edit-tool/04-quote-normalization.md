# 引号规范化（Quote Normalization）

> 分析对象：src/agent/tools/edit.ts @ da24438

---

## 问题定义

模型输入的 `old_string` 通常使用 straight quotes（`"` 和 `'`），但实际文件可能使用 curly quotes（`"` `"` `'` `'`）。这会导致字符串匹配失败（错误码 8）。

**典型场景**：从 Word、网页复制的文本常包含 curly quotes。

## 核心常量

```typescript
const LEFT_SINGLE_CURLY_QUOTE = '‘'   // U+2018
const RIGHT_SINGLE_CURLY_QUOTE = '’'  // U+2019
const LEFT_DOUBLE_CURLY_QUOTE = '“'   // U+201C
const RIGHT_DOUBLE_CURLY_QUOTE = '”'  // U+201D
```

## normalizeQuotes

将所有 curly quotes 替换为对应的 straight quotes：

```typescript
function normalizeQuotes(str: string): string {
  return str
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"')
}
```

## findActualString

先在文件中精确匹配，失败则尝试规范化匹配：

```typescript
function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) {
    return searchString  // 精确匹配成功
  }
  
  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  
  if (searchIndex !== -1) {
    // 规范化匹配成功，返回文件中实际存在的字符串
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  
  return null
}
```

## preserveQuoteStyle

如果匹配成功是因为 curly quotes，将 `new_string` 中的对应引号也转换为 curly quotes，保持文件原有排版风格。

```typescript
function preserveQuoteStyle(
  oldString: string,
  actualOldString: string,
  newString: string,
): string {
  if (oldString === actualOldString) return newString  // 无规范化发生
  
  const hasDoubleQuotes = actualOldString.includes(LEFT_DOUBLE_CURLY_QUOTE)
    || actualOldString.includes(RIGHT_DOUBLE_CURLY_QUOTE)
  const hasSingleQuotes = actualOldString.includes(LEFT_SINGLE_CURLY_QUOTE)
    || actualOldString.includes(RIGHT_SINGLE_CURLY_QUOTE)
  
  if (!hasDoubleQuotes && !hasSingleQuotes) return newString
  
  let result = newString
  if (hasDoubleQuotes) result = applyCurlyDoubleQuotes(result)
  if (hasSingleQuotes) result = applyCurlySingleQuotes(result)
  return result
}
```

## 引号方向判断

使用简单的上下文启发式规则判断引号是"开"还是"闭"：

```typescript
function isOpeningContext(chars: string[], index: number): boolean {
  if (index === 0) return true
  const prev = chars[index - 1]
  return /\s|[([{—–]/.test(prev)  // 空白或开括号前为开引号
}
```

## 单引号的特殊处理：Apostrophe

英语中的缩略形式（don't、it's）使用 right single curly quote 而非 straight quote：

```typescript
// 在 applyCurlySingleQuotes 中
const prevIsLetter = prev !== undefined && /\p{L}/u.test(prev)
const nextIsLetter = next !== undefined && /\p{L}/u.test(next)
if (prevIsLetter && nextIsLetter) {
  result.push(RIGHT_SINGLE_CURLY_QUOTE)  // apostrophe
} else {
  result.push(isOpeningContext(chars, i) ? LEFT_SINGLE_CURLY_QUOTE : RIGHT_SINGLE_CURLY_QUOTE)
}
```

## 为什么返回 actualOldString 但 newString 保持不变

- `oldString` 返回 `actualOldString`（文件中的实际字符串）
- `newString` 返回原始的 `new_string`（模型输入的 straight quotes）

这样设计的原因是：
1. 模型看到的内容是它自己输入的，不会产生困惑
2. 文件被正确写入了 `actualNewString`（带 curly quotes）
3. 保持了模型与文件排版风格的隔离

## 执行流程中的位置

```typescript
const actualOldString = findActualString(content, old_string) || old_string
const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string)
newContent = replace_all
  ? content.replaceAll(actualOldString, actualNewString)
  : content.replace(actualOldString, actualNewString)
```
