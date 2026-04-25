# Diff Formatter 重构设计文档

> 目标：消除重复代码、恢复类型安全、使用标准库函数
> 范围：仅重构，不改变行为
> 日期：2026-04-26

---

## 一、当前问题

### 1.1 Duplicate Code

`edit.ts` 和 `write.ts` 的 `formatResult` 中有完全相同的 diff 格式化逻辑：

```typescript
const diffText = formatPatchToText(output.filePath, output.structuredPatch ?? []);
const text = diffText
  ? `前缀消息\n\n${diffText}`
  : `前缀消息`;
```

### 1.2 Primitive Obsession

`structuredPatch: Type.Any()` 丢失了类型安全。

### 1.3 重复造轮子

`formatPatchToText` 手动拼接 diff 字符串，但 `diff` 库已有 `formatPatch()`。

---

## 二、重构方案

### 2.1 Extract `formatResultWithDiff`（消除重复）

新增 `diff-formatter.ts` 导出：

```typescript
/**
 * 将基础消息和 diff patch 组合为 LLM 可见的文本
 * @param filePath 文件路径
 * @param hunks patch hunks
 * @param baseMessage 基础成功消息（不含 diff）
 * @returns 组合后的文本
 */
export function formatResultWithDiff(
  filePath: string,
  hunks: StructuredPatchHunk[],
  baseMessage: string,
): string;
```

### 2.2 使用 `diff.formatPatch`（消除手动拼接）

`formatPatchToText` 内部改用 `formatPatch()`：

```typescript
import { formatPatch } from "diff";

export function formatPatchToText(
  filePath: string,
  hunks: StructuredPatchHunk[],
): string {
  if (hunks.length === 0) return "";
  return formatPatch({ oldFileName: filePath, newFileName: filePath, hunks });
}
```

### 2.3 定义 TypeBox schema（恢复类型安全）

```typescript
const structuredPatchHunkSchema = Type.Object({
  oldStart: Type.Number(),
  oldLines: Type.Number(),
  newStart: Type.Number(),
  newLines: Type.Number(),
  lines: Type.Array(Type.String()),
});

// outputSchema 中使用
structuredPatch: Type.Array(structuredPatchHunkSchema),
```

---

## 三、修改清单

| 文件 | 修改 |
|------|------|
| `diff-formatter.ts` | 添加 `formatResultWithDiff`；`formatPatchToText` 改用 `formatPatch`；导出 schema |
| `edit.ts` | `outputSchema` 使用 `structuredPatchHunkSchema`；`formatResult` 调用 `formatResultWithDiff` |
| `write.ts` | 同上 |
| `diff-formatter.test.ts` | 添加 `formatResultWithDiff` 和 `formatPatch` 使用测试 |

---

## 四、风险评估

| 风险 | 缓解 |
|------|------|
| `formatPatch` 输出格式与手动拼接不同 | 测试捕获：diff 文本仍包含 `--- a/` 和 `+++ b/` |
| TypeBox schema 与 diff 库类型不一致 | 测试捕获：patch 生成和格式化仍正常工作 |
| 行为改变 | 51 个现有测试必须全部通过 |

---

*本重构不改变任何外部行为，仅优化内部结构。*
