# EditTool Diff 生成功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 EditTool / WriteTool 添加 diff/patch 生成能力，通过 `formatResult` 将结构化 diff 展示给 LLM。

**Architecture:** 新增独立 `diff-formatter.ts` 模块封装 `diff` 库的 `structuredPatch`，提供 `generatePatch()` 和 `formatPatchToText()` 两个纯函数。EditTool 和 WriteTool 在 `execute()` 中调用 `generatePatch()` 生成 patch 存入 output，`formatResult()` 中用 `formatPatchToText()` 转为标准 diff 文本传给 LLM。

**Tech Stack:** TypeScript, Bun, `diff` 库（已有依赖）, `@sinclair/typebox`

---

## 工程规范提醒

实现前请阅读以下规则文件，确保代码风格一致：
- `.claude/rules/code.md` —— 最小代码、精确修改、不要改无关代码
- `.claude/rules/typescript.md` —— interface 优先、字段加中文注释

---

## 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/agent/tools/diff-formatter.ts` | 新增 | diff patch 生成与格式化 |
| `src/agent/tools/diff-formatter.test.ts` | 新增 | diff-formatter 单元测试 |
| `src/agent/tools/edit.ts` | 修改 | 集成 patch 生成到 outputSchema/execute/formatResult |
| `src/agent/tools/edit.test.ts` | 修改 | 扩展测试验证 diff 输出 |
| `src/agent/tools/write.ts` | 修改 | 集成 patch 生成到 outputSchema/execute/formatResult |
| `src/agent/tools/write.test.ts` | 修改 | 扩展测试验证 diff 输出 |

---

### Task 1: diff-formatter.ts 核心实现与测试

**Files:**
- Create: `src/agent/tools/diff-formatter.ts`
- Create: `src/agent/tools/diff-formatter.test.ts`

- [ ] **Step 1: 写第一个失败测试（正常替换生成 patch）**

```typescript
import { describe, it, expect } from "bun:test";
import { generatePatch, formatPatchToText } from "./diff-formatter.js";

describe("diff-formatter", () => {
  it("generatePatch 应生成结构化 patch", () => {
    const hunks = generatePatch("src/foo.ts", "hello\nworld\n", "hello\nworld!\n");
    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks[0].oldStart).toBeGreaterThan(0);
    expect(hunks[0].lines.some((l) => l.startsWith("-"))).toBe(true);
    expect(hunks[0].lines.some((l) => l.startsWith("+"))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/tools/diff-formatter.test.ts`
Expected: FAIL —— `Cannot find module './diff-formatter.js'`

- [ ] **Step 3: 实现 diff-formatter.ts**

```typescript
// src/agent/tools/diff-formatter.ts
import { type StructuredPatchHunk, structuredPatch } from "diff";

const AMPERSAND_TOKEN = "<<:AMPERSAND_TOKEN:>>";
const DOLLAR_TOKEN = "<<:DOLLAR_TOKEN:>>";

/** diff 库 workaround：& 和 $ 会 confuse diff 库的正则实现 */
function escapeForDiff(s: string): string {
  return s.replaceAll("&", AMPERSAND_TOKEN).replaceAll("$", DOLLAR_TOKEN);
}

function unescapeFromDiff(s: string): string {
  return s.replaceAll(AMPERSAND_TOKEN, "&").replaceAll(DOLLAR_TOKEN, "$");
}

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

/**
 * 将结构化 patch 格式化为标准 unified diff 文本
 * @param filePath 文件路径
 * @param hunks patch hunks
 * @returns 标准 diff 字符串，空数组时返回空字符串
 */
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

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/tools/diff-formatter.test.ts`
Expected: PASS

- [ ] **Step 5: 补充剩余测试用例**

```typescript
import { describe, it, expect } from "bun:test";
import { generatePatch, formatPatchToText } from "./diff-formatter.js";

describe("diff-formatter", () => {
  it("generatePatch 应生成结构化 patch", () => {
    const hunks = generatePatch("src/foo.ts", "hello\nworld\n", "hello\nworld!\n");
    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks[0].oldStart).toBeGreaterThan(0);
    expect(hunks[0].lines.some((l) => l.startsWith("-"))).toBe(true);
    expect(hunks[0].lines.some((l) => l.startsWith("+"))).toBe(true);
  });

  it("generatePatch 无变化时应返回空数组", () => {
    const hunks = generatePatch("src/foo.ts", "same\n", "same\n");
    expect(hunks.length).toBe(0);
  });

  it("generatePatch 应保留 & 字符", () => {
    const hunks = generatePatch("src/foo.ts", "a & b\n", "a & c\n");
    expect(hunks.length).toBeGreaterThan(0);
    const allLines = hunks.flatMap((h) => h.lines).join("\n");
    expect(allLines).toContain("&");
  });

  it("generatePatch 应保留 $ 字符", () => {
    const hunks = generatePatch("src/foo.ts", "a $ b\n", "a $ c\n");
    expect(hunks.length).toBeGreaterThan(0);
    const allLines = hunks.flatMap((h) => h.lines).join("\n");
    expect(allLines).toContain("$");
  });

  it("formatPatchToText 应输出标准 diff 格式", () => {
    const hunks = generatePatch("src/foo.ts", "hello\nworld\n", "hello\nworld!\n");
    const text = formatPatchToText("src/foo.ts", hunks);
    expect(text).toContain("--- a/src/foo.ts");
    expect(text).toContain("+++ b/src/foo.ts");
    expect(text).toContain("@@");
  });

  it("formatPatchToText 空数组时应返回空字符串", () => {
    const text = formatPatchToText("src/foo.ts", []);
    expect(text).toBe("");
  });
});
```

- [ ] **Step 6: 运行全部测试确认通过**

Run: `bun test src/agent/tools/diff-formatter.test.ts`
Expected: 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools/diff-formatter.ts src/agent/tools/diff-formatter.test.ts
git commit -m "feat(diff): add diff-formatter module for patch generation"
```

---

### Task 2: EditTool 集成 diff 生成

**Files:**
- Modify: `src/agent/tools/edit.ts`
- Modify: `src/agent/tools/edit.test.ts`

- [ ] **Step 1: 写失败测试（验证 EditTool execute 返回 structuredPatch）**

在 `src/agent/tools/edit.test.ts` 末尾新增测试组：

```typescript
describe("EditTool diff generation", () => {
  it("execute 应返回 structuredPatch", async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/edit-diff.ts', 'export const x = 1;\n', 'utf-8');
    const stats = await stat('/tmp/edit-diff.ts');
    cache.recordRead('/tmp/edit-diff.ts', 'export const x = 1;\n', Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    try {
      const result = await tool.execute!('call-1', {
        file_path: '/tmp/edit-diff.ts',
        old_string: 'export const x = 1;',
        new_string: 'export const x = 2;',
      }, mockContext(cache));

      expect(result.structuredPatch).toBeDefined();
      expect(result.structuredPatch.length).toBeGreaterThan(0);
    } finally {
      await unlink('/tmp/edit-diff.ts').catch(() => {});
    }
  });

  it("formatResult 应包含 diff 文本", async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/edit-diff2.ts', 'export const x = 1;\n', 'utf-8');
    const stats = await stat('/tmp/edit-diff2.ts');
    cache.recordRead('/tmp/edit-diff2.ts', 'export const x = 1;\n', Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    try {
      const output = await tool.execute!('call-1', {
        file_path: '/tmp/edit-diff2.ts',
        old_string: 'export const x = 1;',
        new_string: 'export const x = 2;',
      }, mockContext(cache));

      const formatted = tool.formatResult!(output, 'call-1');
      expect(formatted[0].text).toContain("--- a/");
      expect(formatted[0].text).toContain("+++ b/");
    } finally {
      await unlink('/tmp/edit-diff2.ts').catch(() => {});
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/tools/edit.test.ts`
Expected: FAIL —— `structuredPatch` 字段不存在 或 `Cannot find module './diff-formatter.js'`（如果 import 已加）

- [ ] **Step 3: 修改 edit.ts 导入和 outputSchema**

在 `src/agent/tools/edit.ts` 第 6 行后新增 import：

```typescript
import { generatePatch, formatPatchToText } from "./diff-formatter.js";
```

修改 `editOutputSchema`（第 131-137 行）：

```typescript
const editOutputSchema = Type.Object({
  filePath: Type.String(),
  oldString: Type.String(),
  newString: Type.String(),
  originalFile: Type.String(),
  replaceAll: Type.Boolean(),
  // 新增：结构化 patch，供 formatResult 和未来 TUI 使用
  structuredPatch: Type.Optional(Type.Any()),
});
```

- [ ] **Step 4: 修改 edit.ts execute 生成 patch**

在 `execute` 中，`await writeFileWithEncoding(...)` 之后、`return` 之前，插入 patch 生成：

```typescript
      await writeFileWithEncoding(fullPath, newContent, fileEncoding);

      // 【新增】生成 diff patch
      const patch = generatePatch(fullPath, content, newContent);

      // 【新增】更新缓存
```

修改 `return` 语句（在 `context.fileStateCache.recordEdit(...)` 之后）：

```typescript
      return {
        filePath: fullPath,
        oldString: actualOldString,
        newString: new_string,
        originalFile: content,
        replaceAll: replace_all,
        structuredPatch: patch,  // 新增
      };
```

- [ ] **Step 5: 修改 edit.ts formatResult 输出 diff**

将 `formatResult` 替换为：

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
    },
```

- [ ] **Step 6: 运行 EditTool 测试确认通过**

Run: `bun test src/agent/tools/edit.test.ts`
Expected: 原有测试全部 PASS + 新增 2 个 diff 测试 PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit): generate structured diff patch and show it to LLM"
```

---

### Task 3: WriteTool 集成 diff 生成

**Files:**
- Modify: `src/agent/tools/write.ts`
- Modify: `src/agent/tools/write.test.ts`

- [ ] **Step 1: 写失败测试（验证 WriteTool execute 返回 structuredPatch）**

在 `src/agent/tools/write.test.ts` 末尾新增测试组：

```typescript
describe("WriteTool diff generation", () => {
  it("覆盖文件时应返回 structuredPatch", async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-diff.txt', 'old content\n', 'utf-8');
    const stats = await stat('/tmp/write-diff.txt');
    cache.recordRead('/tmp/write-diff.txt', 'old content\n', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    try {
      const result = await tool.execute!('call-1', {
        file_path: '/tmp/write-diff.txt',
        content: 'new content\n',
      }, mockContext(cache));

      expect(result.structuredPatch).toBeDefined();
      expect(result.structuredPatch.length).toBeGreaterThan(0);
    } finally {
      await unlink('/tmp/write-diff.txt').catch(() => {});
    }
  });

  it("formatResult 覆盖文件时应包含 diff 文本", async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-diff2.txt', 'old content\n', 'utf-8');
    const stats = await stat('/tmp/write-diff2.txt');
    cache.recordRead('/tmp/write-diff2.txt', 'old content\n', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    try {
      const output = await tool.execute!('call-1', {
        file_path: '/tmp/write-diff2.txt',
        content: 'new content\n',
      }, mockContext(cache));

      const formatted = tool.formatResult!(output, 'call-1');
      expect(formatted[0].text).toContain("--- a/");
      expect(formatted[0].text).toContain("+++ b/");
    } finally {
      await unlink('/tmp/write-diff2.txt').catch(() => {});
    }
  });

  it("创建新文件时不应有 structuredPatch", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const result = await tool.execute!('call-1', {
      file_path: '/tmp/write-new-diff.txt',
      content: 'new content\n',
    }, mockContext(cache));

    expect(result.type).toBe("create");
    // structuredPatch 可能未定义或为空数组
    const hasPatch = result.structuredPatch != null && result.structuredPatch.length > 0;
    expect(hasPatch).toBe(false);

    await unlink('/tmp/write-new-diff.txt').catch(() => {});
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/tools/write.test.ts`
Expected: FAIL —— `structuredPatch` 字段不存在

- [ ] **Step 3: 修改 write.ts 导入和 outputSchema**

在 `src/agent/tools/write.ts` 第 9 行后新增 import：

```typescript
import { generatePatch, formatPatchToText } from "./diff-formatter.js";
```

修改 `writeOutputSchema`（第 16-21 行）：

```typescript
const writeOutputSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  filePath: Type.String(),
  content: Type.String(),
  originalFile: Type.Union([Type.String(), Type.Null()]),
  // 新增：结构化 patch
  structuredPatch: Type.Optional(Type.Any()),
});
```

- [ ] **Step 4: 修改 write.ts execute 生成 patch**

在 `execute` 中，在 `await writeFileWithEncoding(...)` 之前插入 patch 生成逻辑：

```typescript
      let patch: import("diff").StructuredPatchHunk[] = [];
      if (originalFile !== null) {
        patch = generatePatch(fullPath, originalFile, params.content);
      }

      await mkdir(dirname(fullPath), { recursive: true });
```

修改 `return` 语句：

```typescript
      return {
        type: originalFile === null ? "create" : "update",
        filePath: fullPath,
        content: params.content,
        originalFile,
        structuredPatch: patch,  // 新增
      };
```

- [ ] **Step 5: 修改 write.ts formatResult 输出 diff**

将 `formatResult` 替换为：

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
    },
```

- [ ] **Step 6: 运行 WriteTool 测试确认通过**

Run: `bun test src/agent/tools/write.test.ts`
Expected: 原有测试全部 PASS + 新增 3 个 diff 测试 PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools/write.ts src/agent/tools/write.test.ts
git commit -m "feat(write): generate structured diff patch and show it to LLM"
```

---

### Task 4: 回归测试与最终提交

- [ ] **Step 1: 运行全部 tool 相关测试**

Run: `bun test src/agent/tools/`
Expected: 所有测试 PASS（diff-formatter + edit + write + file-encoding + file-guard）

- [ ] **Step 2: TypeScript 类型检查**

Run: `bun run typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit（如有未提交的变更）**

```bash
git status
# 如有未提交变更：
git add -A
git commit -m "test: add diff generation integration tests for EditTool and WriteTool"
```

---

## Spec 覆盖检查

| 设计文档章节 | 对应任务 |
|-------------|---------|
| 三、diff-formatter.ts | Task 1 |
| 四、edit.ts 修改 | Task 2 |
| 五、write.ts 修改 | Task 3 |
| 七、边界情况（&/$、空patch、新文件） | Task 1-3 的测试用例已覆盖 |
| 八、测试策略 | Task 1-4 |

---

*本计划遵循 TDD：每个任务先写失败测试，再实现代码，再运行测试确认通过。*
