# EditTool Diff 生成功能设计文档

> 目标：为 EditTool / WriteTool 添加 diff/patch 生成能力，通过 `formatResult` 将变更细节展示给 LLM
> 范围：仅 LLM 上下文增强（不涉及 TUI 渲染）
> 日期：2026-04-26

---

## 一、设计概述

### 1.1 背景

当前 ys-code EditTool 执行后，`formatResult` 仅返回简单文本（"The file has been updated successfully"），LLM 无法看到具体改了哪些行。与 cc 的 FileEditTool 对比，核心差距在于 **diff/patch 生成能力**。

cc 的 `FileEditTool.execute()` 使用 `diff` 库生成 `StructuredPatchHunk[]`，并伴随以下能力：
- `formatPatch()` 转为标准 diff 文本
- `countLinesChanged()` 统计增删行数（分析日志）
- `escapeForDiff()` 处理 `&` / `$` 字符的 workaround

### 1.2 核心思路

借鉴 cc 的分层架构，新增独立的 `diff-formatter.ts` 模块，为 EditTool 和 WriteTool 提供 patch 生成与格式化能力。

---

## 二、架构设计

```
src/agent/tools/
├── diff-formatter.ts      ← 新增
│   ├── generatePatch()        ← 生成 StructuredPatchHunk[]
│   ├── formatPatchToText()    ← 转为标准 diff 字符串
│   └── escapeForDiff()        ← &/$ workaround
│
├── edit.ts                  ← 修改
│   ├── outputSchema           ← 新增 structuredPatch 字段
│   ├── execute()              ← 调用 generatePatch
│   └── formatResult()         ← 用 formatPatchToText 生成 LLM 文本
│
├── write.ts                 ← 修改
│   ├── outputSchema           ← 新增 structuredPatch 字段
│   ├── execute()              ← 调用 generatePatch
│   └── formatResult()         ← 同上
│
└── diff-formatter.test.ts   ← 新增测试
```

---

## 三、diff-formatter.ts 详细设计

### 3.1 接口定义

```typescript
import { type StructuredPatchHunk, structuredPatch } from "diff";

/**
 * 生成文件变更的结构化 patch
 * @param filePath 文件路径（用于 diff 头部信息）
 * @param oldContent 变更前的内容
 * @param newContent 变更后的内容
 * @returns StructuredPatchHunk 数组，内容未变或 diff 库异常时返回空数组
 */
export function generatePatch(
  filePath: string,
  oldContent: string,
  newContent: string,
): StructuredPatchHunk[];

/**
 * 将结构化 patch 格式化为标准 unified diff 文本
 * @param filePath 文件路径
 * @param hunks patch hunks
 * @returns 标准 diff 字符串，空数组时返回空字符串
 */
export function formatPatchToText(
  filePath: string,
  hunks: StructuredPatchHunk[],
): string;
```

### 3.2 generatePatch 实现

```typescript
const AMPERSAND_TOKEN = "<<:AMPERSAND_TOKEN:>>";
const DOLLAR_TOKEN = "<<:DOLLAR_TOKEN:>>";

function escapeForDiff(s: string): string {
  return s.replaceAll("&", AMPERSAND_TOKEN).replaceAll("$", DOLLAR_TOKEN);
}

function unescapeFromDiff(s: string): string {
  return s.replaceAll(AMPERSAND_TOKEN, "&").replaceAll(DOLLAR_TOKEN, "$");
}

export function generatePatch(
  filePath: string,
  oldContent: string,
  newContent: string,
): StructuredPatchHunk[] {
  const result = structuredPatch(
    filePath,
    filePath,
    escapeForDiff(oldContent),
    escapeForDiff(newContent),
    undefined,
    undefined,
    { context: 3 },
  );

  if (!result) {
    return [];
  }

  return result.hunks.map((h) => ({
    ...h,
    lines: h.lines.map(unescapeFromDiff),
  }));
}
```

**与 cc 的差异**：
- 暂不设置 `timeout`（`checkFileSize` 已限制文件大小，diff 计算通常很快）
- 不转换 leading tabs to spaces（TUI 层需要时再加）

### 3.3 formatPatchToText 实现

```typescript
export function formatPatchToText(
  filePath: string,
  hunks: StructuredPatchHunk[],
): string {
  if (hunks.length === 0) {
    return "";
  }

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  for (const hunk of hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    for (const line of hunk.lines) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}
```

---

## 四、edit.ts 修改点

### 4.1 outputSchema 扩展

```typescript
const editOutputSchema = Type.Object({
  filePath: Type.String(),
  oldString: Type.String(),
  newString: Type.String(),
  originalFile: Type.String(),
  replaceAll: Type.Boolean(),
  // 新增
  structuredPatch: Type.Optional(Type.Any()),
});
```

### 4.2 execute 中生成 patch

```typescript
async execute(_toolCallId, params, context) {
  // ... 现有逻辑：读取文件、二次脏写检测、应用编辑 ...

  const patch = generatePatch(fullPath, content, newContent);

  // ... 写入文件、更新缓存 ...

  return {
    filePath: fullPath,
    oldString: actualOldString,
    newString: new_string,
    originalFile: content,
    replaceAll: replace_all,
    structuredPatch: patch,  // 新增
  };
}
```

### 4.3 formatResult 输出 diff 文本

```typescript
formatResult(output, _toolCallId) {
  const diffText = formatPatchToText(output.filePath, output.structuredPatch ?? []);

  if (output.replaceAll) {
    const text = diffText
      ? `The file ${output.filePath} has been updated. All occurrences were successfully replaced.\n\n${diffText}`
      : `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`;
    return [{ type: "text" as const, text }];
  }

  const text = diffText
    ? `The file ${output.filePath} has been updated successfully.\n\n${diffText}`
    : `The file ${output.filePath} has been updated successfully.`;
  return [{ type: "text" as const, text }];
}
```

---

## 五、write.ts 修改点

### 5.1 outputSchema 扩展

```typescript
const writeOutputSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  filePath: Type.String(),
  content: Type.String(),
  originalFile: Type.Union([Type.String(), Type.Null()]),
  // 新增
  structuredPatch: Type.Optional(Type.Any()),
});
```

### 5.2 execute 中生成 patch

```typescript
async execute(_toolCallId, params, context) {
  // ... 现有逻辑 ...

  let patch: StructuredPatchHunk[] = [];
  if (originalFile !== null) {
    patch = generatePatch(fullPath, originalFile, params.content);
  }

  // ... 写入文件 ...

  return {
    type: originalFile === null ? "create" : "update",
    filePath: fullPath,
    content: params.content,
    originalFile,
    structuredPatch: patch,  // 新增
  };
}
```

### 5.3 formatResult 输出 diff 文本

```typescript
formatResult(output, _toolCallId) {
  if (output.type === "create") {
    return [{
      type: "text" as const,
      text: `File created successfully at: ${output.filePath}`,
    }];
  }

  const diffText = formatPatchToText(output.filePath, output.structuredPatch ?? []);
  const text = diffText
    ? `The file ${output.filePath} has been updated successfully.\n\n${diffText}`
    : `The file ${output.filePath} has been updated successfully.`;
  return [{ type: "text" as const, text }];
}
```

---

## 六、formatResult 输出格式示例

**EditTool 单次替换：**

```diff
The file /project/src/foo.ts has been updated successfully.

--- a//project/src/foo.ts
+++ b//project/src/foo.ts
@@ -10,7 +10,7 @@
 import { foo } from './bar';
 
-export const x = 1;
+export const x = 2;
 
 function main() {
```

**WriteTool 覆盖文件：**

```diff
The file /project/src/foo.ts has been updated successfully.

--- a//project/src/foo.ts
+++ b//project/src/foo.ts
@@ -1,5 +1,5 @@
 function greet() {
-  console.log("hello");
+  console.log("world");
   return 42;
 }
```

---

## 七、边界情况

| 场景 | 行为 |
|------|------|
| **新文件创建**（WriteTool `originalFile === null`） | 不生成 patch，`formatResult` 输出 "File created..." |
| **空文件 + `old_string === ''`**（EditTool 创建） | `oldContent = ''`，`generatePatch` 返回包含全部新增行的 patch |
| **空文件 + `new_string === ''`**（创建空文件） | `generatePatch` 可能返回 `[]`，`formatResult` fallback 到简单文本 |
| **内容实际未变**（`oldContent === newContent`） | `structuredPatch` 返回 `undefined`，`generatePatch` 返回 `[]` |
| **`&` / `$` 字符** | `escapeForDiff` 先转义，diff 计算后 `unescapeFromDiff` 恢复 |
| **patch 为空数组** | `formatPatchToText` 返回空字符串，`formatResult` 不附加 diff 块 |

---

## 八、测试策略

### 8.1 diff-formatter.test.ts

| 测试用例 | 预期 |
|---------|------|
| `generatePatch` 正常替换 | 返回非空 hunks，行号正确 |
| `generatePatch` 无变化 | 返回 `[]` |
| `generatePatch` 含 `&` 字符 | patch 中保留 `&` |
| `generatePatch` 含 `$` 字符 | patch 中保留 `$` |
| `formatPatchToText` 正常 hunks | 输出标准 diff 格式 |
| `formatPatchToText` 空数组 | 返回空字符串 |

### 8.2 edit.test.ts 扩展

| 测试用例 | 预期 |
|---------|------|
| 单次替换后 `structuredPatch` 非空 | `result.structuredPatch.length > 0` |
| `formatResult` 包含 diff 文本 | `text` 包含 `--- a/` 和 `+++ b/` |
| `replace_all=true` | diff 文本包含所有变更点 |

### 8.3 write.test.ts 扩展

| 测试用例 | 预期 |
|---------|------|
| 覆盖文件后 `structuredPatch` 非空 | `result.structuredPatch.length > 0` |
| 创建新文件 | `structuredPatch` 未定义或为空 |
| `formatResult` 新文件 | 文本为 "File created..."，不含 diff |

---

## 九、与 cc 的对标

| 能力 | cc | ys-code（本设计） |
|------|-----|------------------|
| `structuredPatch` 生成 | ✅ `getPatchFromContents` | ✅ `generatePatch` |
| `formatPatch` 格式化 | ✅ 使用 `formatPatch()` | ✅ 手动实现 `formatPatchToText` |
| `&` / `$` workaround | ✅ `escapeForDiff` | ✅ 保留 |
| tab→spaces 转换 | ✅ `getPatchForDisplay` | ❌ 暂不实现（TUI 需要时再加） |
| `countLinesChanged` | ✅ 分析日志 | ❌ 暂不实现 |
| timeout 保护 | ✅ `DIFF_TIMEOUT_MS = 5s` | ❌ 暂不设置（文件大小已限制） |

---

*本设计遵循最小侵入原则，新增模块独立可测试，修改点集中在 outputSchema、execute、formatResult 三处。*
