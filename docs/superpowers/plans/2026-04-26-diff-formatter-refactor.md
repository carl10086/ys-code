# Diff Formatter 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (small refactor, suitable for inline execution).

**Goal:** 消除 diff 相关代码中的重复代码、恢复类型安全、使用标准库函数。

**Architecture:** 在 `diff-formatter.ts` 中新增 `formatResultWithDiff` 辅助函数和 `structuredPatchHunkSchema` TypeBox schema；`formatPatchToText` 改用 `diff.formatPatch`；`edit.ts` 和 `write.ts` 简化 `formatResult`。

**Tech Stack:** TypeScript, Bun, `diff` 库, `@sinclair/typebox`

---

## 任务分解

### Task 1: 使用 `diff.formatPatch` 替换手动拼接

**Files:**
- Modify: `src/agent/tools/diff-formatter.ts`
- Modify: `src/agent/tools/diff-formatter.test.ts`

- [ ] **Step 1: 添加 `formatPatch` 导入，修改 `formatPatchToText`**

```typescript
import { structuredPatch, formatPatch, type StructuredPatchHunk } from "diff";

export function formatPatchToText(
  filePath: string,
  hunks: StructuredPatchHunk[],
): string {
  if (hunks.length === 0) {
    return "";
  }
  return formatPatch({
    oldFileName: filePath,
    newFileName: filePath,
    oldHeader: undefined,
    newHeader: undefined,
    hunks,
  });
}
```

- [ ] **Step 2: 运行测试确认行为未变**

Run: `bun test src/agent/tools/diff-formatter.test.ts`
Expected: 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/diff-formatter.ts
git commit -m "refactor(diff): use diff.formatPatch instead of manual string concat"
```

---

### Task 2: 添加 `formatResultWithDiff` 消除重复代码

**Files:**
- Modify: `src/agent/tools/diff-formatter.ts`
- Modify: `src/agent/tools/diff-formatter.test.ts`
- Modify: `src/agent/tools/edit.ts`
- Modify: `src/agent/tools/write.ts`

- [ ] **Step 1: 在 `diff-formatter.ts` 中添加 `formatResultWithDiff`**

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
): string {
  const diffText = formatPatchToText(filePath, hunks);
  return diffText ? `${baseMessage}\n\n${diffText}` : baseMessage;
}
```

- [ ] **Step 2: 在 `diff-formatter.test.ts` 中添加测试**

```typescript
it("formatResultWithDiff 有 diff 时应附加 diff", () => {
  const hunks = generatePatch("test.txt", "old\n", "new\n");
  const text = formatResultWithDiff("test.txt", hunks, "Updated.");
  expect(text).toContain("Updated.");
  expect(text).toContain("--- a/test.txt");
});

it("formatResultWithDiff 无 diff 时应仅返回基础消息", () => {
  const text = formatResultWithDiff("test.txt", [], "Updated.");
  expect(text).toBe("Updated.");
});
```

Run: `bun test src/agent/tools/diff-formatter.test.ts`
Expected: 8 tests PASS

- [ ] **Step 3: 简化 `edit.ts` 的 `formatResult`**

```typescript
formatResult(output, _toolCallId) {
  const baseMessage = output.replaceAll
    ? `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`
    : `The file ${output.filePath} has been updated successfully.`;
  const text = formatResultWithDiff(output.filePath, output.structuredPatch ?? [], baseMessage);
  return [{ type: "text" as const, text }];
},
```

- [ ] **Step 4: 简化 `write.ts` 的 `formatResult`**

```typescript
formatResult(output, _toolCallId) {
  if (output.type === "create") {
    return [{
      type: "text" as const,
      text: `File created successfully at: ${output.filePath}`,
    }];
  }

  const baseMessage = `The file ${output.filePath} has been updated successfully.`;
  const text = formatResultWithDiff(output.filePath, output.structuredPatch ?? [], baseMessage);
  return [{ type: "text" as const, text }];
},
```

- [ ] **Step 5: 运行全部测试确认行为未变**

Run: `bun test src/agent/tools/`
Expected: 51 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools/diff-formatter.ts src/agent/tools/diff-formatter.test.ts src/agent/tools/edit.ts src/agent/tools/write.ts
git commit -m "refactor(diff): extract formatResultWithDiff to eliminate duplication"
```

---

### Task 3: 定义 TypeBox schema 恢复类型安全

**Files:**
- Modify: `src/agent/tools/diff-formatter.ts`
- Modify: `src/agent/tools/edit.ts`
- Modify: `src/agent/tools/write.ts`

- [ ] **Step 1: 在 `diff-formatter.ts` 中导出 schema**

```typescript
import { Type } from "@sinclair/typebox";

export const structuredPatchHunkSchema = Type.Object({
  /** 旧文件起始行号 */
  oldStart: Type.Number(),
  /** 旧文件行数 */
  oldLines: Type.Number(),
  /** 新文件起始行号 */
  newStart: Type.Number(),
  /** 新文件行数 */
  newLines: Type.Number(),
  /** 差异行列表（以 +、-、空格开头） */
  lines: Type.Array(Type.String()),
});
```

- [ ] **Step 2: 在 `edit.ts` 中使用 schema**

```typescript
import { structuredPatchHunkSchema } from "./diff-formatter.js";

const editOutputSchema = Type.Object({
  filePath: Type.String(),
  oldString: Type.String(),
  newString: Type.String(),
  originalFile: Type.String(),
  replaceAll: Type.Boolean(),
  structuredPatch: Type.Array(structuredPatchHunkSchema),
});
```

- [ ] **Step 3: 在 `write.ts` 中使用 schema**

```typescript
import { structuredPatchHunkSchema } from "./diff-formatter.js";

const writeOutputSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  filePath: Type.String(),
  content: Type.String(),
  originalFile: Type.Union([Type.String(), Type.Null()]),
  structuredPatch: Type.Array(structuredPatchHunkSchema),
});
```

- [ ] **Step 4: 运行 typecheck 和全部测试**

Run: `bun run typecheck`
Expected: 零错误

Run: `bun test src/agent/tools/`
Expected: 51 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/diff-formatter.ts src/agent/tools/edit.ts src/agent/tools/write.ts
git commit -m "refactor(diff): add TypeBox schema for StructuredPatchHunk to restore type safety"
```

---

## Spec 覆盖检查

| 设计文档章节 | 对应任务 |
|-------------|---------|
| 2.1 Extract `formatResultWithDiff` | Task 2 |
| 2.2 使用 `diff.formatPatch` | Task 1 |
| 2.3 定义 TypeBox schema | Task 3 |
