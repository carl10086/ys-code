# EditTool 执行时序

> 分析对象：src/agent/tools/edit.ts @ da24438
> 日期：2026-04-24

---

## 概述

EditTool 是 ys-code 中用于**精确字符串替换**的文件编辑工具。一次完整的 Edit 调用经历两个阶段：`validateInput`（校验）和 `execute`（执行）。

```
模型发起 Edit
    |
    v
validateInput (第一层防线)
    |-- 先读后写检查 (错误码 6)
    |-- 脏写检测第一层 (错误码 7)
    |-- old_string === new_string (错误码 1)
    |-- 文件存在性检查 (错误码 3/4)
    |-- 字符串匹配检查 (错误码 8)
    |-- 多匹配检测 (错误码 9)
    v
execute (执行写入)
    |-- 二次脏写检测
    |-- 引号规范化
    |-- 字符串替换
    |-- 写入文件
    |-- 更新 FileStateCache
    v
返回结果
```

---

## validateInput 阶段

`validateInput` 在模型提出编辑请求后立即执行，是**第一道防线**。

### 1. 先读后写检查

```typescript
const readCheck = context.fileStateCache.canEdit(fullPath);
if (!readCheck.ok) {
  return { ok: false, message: readCheck.reason, errorCode: readCheck.errorCode };
}
```

- 检查文件是否已通过 ReadTool 读取
- 检查是否为部分读取（offset/limit/isPartialView）
- 错误码：`6`

### 2. 脏写检测第一层

```typescript
const stats = await stat(fullPath).catch(() => null);
if (stats && readCheck.record) {
  const currentMtime = Math.floor(stats.mtimeMs);
  if (currentMtime > readCheck.record.timestamp) {
    // 部分读取直接拒绝
    // 全量读取对比内容，内容变了才拒绝
  }
}
```

- 对比 mtime（快速）
- mtime 变了再对比 content（准确）
- 错误码：`7`

### 3. 无变化检查

```typescript
if (params.old_string === params.new_string) {
  return { ok: false, message: "No changes...", errorCode: 1 };
}
```

### 4. 文件存在性检查

- 文件不存在且 old_string 非空 → 错误码 `4`
- 文件不存在且 old_string 为空 → 允许（创建新文件）
- 文件存在但 old_string 为空 → 错误码 `3`

### 5. 字符串匹配检查（引号规范化）

```typescript
const actualOldString = findActualString(content, params.old_string);
if (!actualOldString) {
  return { ok: false, message: "String not found...", errorCode: 8 };
}
```

- 先精确匹配
- 失败则尝试引号规范化匹配

### 6. 多匹配检测

```typescript
const matches = content.split(actualOldString).length - 1;
if (matches > 1 && !params.replace_all) {
  return { ok: false, message: "Multiple matches...", errorCode: 9 };
}
```

---

## execute 阶段

`execute` 在 `validateInput` 通过后执行，是真正修改文件的阶段。

### 1. 二次脏写检测

```typescript
const record = context.fileStateCache.get(fullPath);
const stats = await stat(fullPath).catch(() => null);
if (stats && record) {
  const currentMtime = Math.floor(stats.mtimeMs);
  if (currentMtime > record.timestamp) {
    const isFullRead = record.offset === undefined && record.limit === undefined;
    const contentUnchanged = isFullRead && content === record.content;
    if (!contentUnchanged) {
      throw new Error('File unexpectedly modified since last read');
    }
  }
}
```

### 2. 引号规范化与替换

```typescript
const actualOldString = findActualString(content, old_string) || old_string;
const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string);
newContent = replace_all
  ? content.replaceAll(actualOldString, actualNewString)
  : content.replace(actualOldString, actualNewString);
```

### 3. 写入与缓存更新

```typescript
await writeFile(fullPath, newContent, "utf-8");
const newStats = await stat(fullPath);
context.fileStateCache.recordEdit(fullPath, newContent, Math.floor(newStats.mtimeMs));
```

---

## 两次脏写检测的时间点对比

```
T1: ReadTool 读取 → 记录 mtime=1000
    |
    v
T2: validateInput → 检查 mtime=1000（通过）
    |
    v
T3: （可能有用户确认间隙）
    |
    |-- 外部 Vim 修改 → mtime=2000
    |
    v
T4: execute → 再次检查 mtime=2000
    |           └── 发现 2000 > 1000
    |           └── 内容也变了
    |           └── 抛出错误
    |
    └── 没被修改 → 继续写入
```

---

## 与相关模块的交互

| 模块 | 交互方式 | 说明 |
|------|---------|------|
| ReadTool | FileStateCache | ReadTool 读取成功后调用 `recordRead()` |
| FileStateCache | validateInput/execute | EditTool 调用 `canEdit()` / `recordEdit()` |
| fs/promises | execute | 读取和写入文件 |
```