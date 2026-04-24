# WriteTool 安全补齐与 EditTool 边界测试完善 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 WriteTool 安全机制（先读后写、脏写检测、文件大小限制），并为 EditTool 脏写检测补充集成测试。

**Architecture:** 新建 file-guard.ts 提供共用文件大小检查；WriteTool 新增 validateInput 实现双层安全；EditTool 和 WriteTool 读取前调用文件大小检查；通过临时文件操作测试脏写触发逻辑。

**Tech Stack:** Bun, TypeScript, fs/promises, lru-cache

---

## 前置检查

**工程师须知：** 实现前请阅读 `./claude/rules/code.md`（编码行为准则）和 `./claude/rules/typescript.md`（TypeScript 规范）。核心要求：
- 最小代码解决问题，不添加未要求的功能
- 只修改必要的代码，不动无关代码
- 定义结构体优先用 interface，字段加中文注释

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agent/tools/file-guard.ts` | 创建 | 文件大小检查工具函数 |
| `src/agent/tools/file-guard.test.ts` | 创建 | file-guard 单元测试 |
| `src/agent/tools/write.ts` | 修改 | 添加 validateInput、execute 脏写检测、缓存更新、文件大小检查 |
| `src/agent/tools/write.test.ts` | 创建 | WriteTool 完整测试（5 个场景）|
| `src/agent/tools/edit.ts` | 修改 | validateInput 读取前接入文件大小检查 |
| `src/agent/tools/edit.test.ts` | 修改 | 添加 3 个脏写集成测试 |

---

### Task 1: 文件大小限制工具 file-guard.ts

**Files:**
- Create: `src/agent/tools/file-guard.ts`
- Create: `src/agent/tools/file-guard.test.ts`

**上下文：** 当前 EditTool 和 WriteTool 在读取文件前都不检查文件大小，大文件（如日志、核心转储）可能导致 OOM。

- [ ] **Step 1: 写 file-guard.test.ts**

```typescript
import { describe, it, expect } from 'bun:test';
import { checkFileSize, MAX_FILE_SIZE_BYTES } from './file-guard.js';
import { writeFile, unlink, stat } from 'fs/promises';

describe('checkFileSize', () => {
  it('小文件应通过检查', async () => {
    await writeFile('/tmp/small.txt', 'hello', 'utf-8');
    await expect(checkFileSize('/tmp/small.txt')).resolves.toBeUndefined();
    await unlink('/tmp/small.txt');
  });

  it('超过限制的文件应抛出错误', async () => {
    // 创建一个 2MB 的文件，限制为 1MB
    const content = 'x'.repeat(2 * 1024 * 1024);
    await writeFile('/tmp/large.txt', content, 'utf-8');
    await expect(checkFileSize('/tmp/large.txt', 1024 * 1024)).rejects.toThrow('File too large');
    await unlink('/tmp/large.txt');
  });

  it('不存在的文件应通过检查', async () => {
    await expect(checkFileSize('/tmp/nonexistent-guard.txt')).resolves.toBeUndefined();
  });

  it('MAX_FILE_SIZE_BYTES 应为 1GB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(1024 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/agent/tools/file-guard.test.ts`
Expected: FAIL（模块未找到或函数未定义）

- [ ] **Step 3: 实现 file-guard.ts**

```typescript
import { stat } from 'fs/promises';

/** 默认文件大小限制：1GB */
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

/**
 * 检查文件大小是否超过限制
 * @param filePath 文件路径
 * @param maxBytes 最大允许字节数，默认 1GB
 * @throws 文件超过限制时抛出 Error
 */
export async function checkFileSize(
  filePath: string,
  maxBytes = MAX_FILE_SIZE_BYTES,
): Promise<void> {
  const stats = await stat(filePath).catch(() => null);
  if (stats && stats.size > maxBytes) {
    throw new Error(
      `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). ` +
        `Maximum allowed: ${(maxBytes / 1024 / 1024).toFixed(0)}MB.`,
    );
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun test src/agent/tools/file-guard.test.ts`
Expected: PASS（4 个测试全部通过）

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/file-guard.ts src/agent/tools/file-guard.test.ts
git commit -m "feat(file-guard): add file size limit utility with tests

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: EditTool 接入文件大小检查

**Files:**
- Modify: `src/agent/tools/edit.ts`

**上下文：** EditTool 的 validateInput 在 `readFile(fullPath, "utf-8")` 之前没有文件大小检查。

- [ ] **Step 1: 修改 edit.ts，添加导入和检查**

在 edit.ts 顶部添加导入：
```typescript
import { checkFileSize } from './file-guard.js';
```

在 validateInput 中，找到 `// 2. 读取文件` 注释前的位置，插入检查：

```typescript
      // 【新增】文件大小检查
      await checkFileSize(fullPath);

      // 2. 读取文件
```

完整上下文（edit.ts 第 168-172 行附近）：
```typescript
      // 【新增】文件大小检查
      await checkFileSize(fullPath);

      // 2. 读取文件
      let content: string;
      try {
        content = await readFile(fullPath, "utf-8");
```

- [ ] **Step 2: 运行 EditTool 测试，确认通过**

Run: `bun test src/agent/tools/edit.test.ts`
Expected: PASS（6 个测试全部通过，无回归）

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/edit.ts
git commit -m "feat(edit): add file size check before reading

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: WriteTool 安全补齐

**Files:**
- Modify: `src/agent/tools/write.ts`
- Create: `src/agent/tools/write.test.ts`

**上下文：** WriteTool 当前只有 execute，没有 validateInput。description 声称覆盖已有文件时会失败，但实际上没有任何检查。

- [ ] **Step 1: 写 WriteTool 测试（write.test.ts）**

```typescript
import { describe, it, expect } from 'bun:test';
import { createWriteTool } from './write.js';
import { FileStateCache } from '../file-state.js';
import type { ToolUseContext } from '../types.js';

function mockContext(cache: FileStateCache): ToolUseContext {
  return {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    fileStateCache: cache,
  } as ToolUseContext;
}

describe('WriteTool', () => {
  it('创建新文件无需先读取', async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-new.txt',
      content: 'hello world',
    }, mockContext(cache));
    expect(result.ok).toBe(true);
  });

  it('覆盖已有文件（未读取）应拒绝', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-exists.txt', 'existing', 'utf-8');

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-exists.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }

    await fs.unlink('/tmp/write-exists.txt').catch(() => {});
  });

  it('覆盖已有文件（已读取）应允许', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-allowed.txt', 'existing', 'utf-8');
    const stats = await fs.stat('/tmp/write-allowed.txt');
    cache.recordRead('/tmp/write-allowed.txt', 'existing', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-allowed.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(true);
    await fs.unlink('/tmp/write-allowed.txt').catch(() => {});
  });

  it('execute 创建新文件', async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const result = await tool.execute!('test-id', {
      file_path: '/tmp/write-create.txt',
      content: 'created content',
    }, mockContext(cache));

    expect(result.type).toBe('create');
    expect(result.filePath).toBe('/tmp/write-create.txt');
    expect(result.originalFile).toBeNull();

    const fs = await import('fs/promises');
    const content = await fs.readFile('/tmp/write-create.txt', 'utf-8');
    expect(content).toBe('created content');
    await fs.unlink('/tmp/write-create.txt').catch(() => {});
  });

  it('execute 覆盖已有文件', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-update.txt', 'old content', 'utf-8');
    const stats = await fs.stat('/tmp/write-update.txt');
    cache.recordRead('/tmp/write-update.txt', 'old content', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const result = await tool.execute!('test-id', {
      file_path: '/tmp/write-update.txt',
      content: 'updated content',
    }, mockContext(cache));

    expect(result.type).toBe('update');
    expect(result.originalFile).toBe('old content');

    const content = await fs.readFile('/tmp/write-update.txt', 'utf-8');
    expect(content).toBe('updated content');
    await fs.unlink('/tmp/write-update.txt').catch(() => {});
  });

  it('连续写入无需重新读取', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-sequential.txt', 'first', 'utf-8');
    const stats = await fs.stat('/tmp/write-sequential.txt');
    cache.recordRead('/tmp/write-sequential.txt', 'first', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');

    // 第一次写入
    await tool.execute!('test-id', {
      file_path: '/tmp/write-sequential.txt',
      content: 'second',
    }, mockContext(cache));

    // 第二次写入不应需要重新读取
    const result = await tool.validateInput!({
      file_path: '/tmp/write-sequential.txt',
      content: 'third',
    }, mockContext(cache));
    expect(result.ok).toBe(true);

    await fs.unlink('/tmp/write-sequential.txt').catch(() => {});
  });

  it('脏写检测应触发 errorCode 7', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-dirty.txt', 'original', 'utf-8');
    const stats = await fs.stat('/tmp/write-dirty.txt');
    cache.recordRead('/tmp/write-dirty.txt', 'original', Math.floor(stats.mtimeMs));

    // 模拟外部修改：修改内容并推进 mtime
    await fs.writeFile('/tmp/write-dirty.txt', 'modified', 'utf-8');
    const future = new Date(Date.now() + 10000);
    await fs.utimes('/tmp/write-dirty.txt', future, future);

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-dirty.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(7);
    }

    await fs.unlink('/tmp/write-dirty.txt').catch(() => {});
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/agent/tools/write.test.ts`
Expected: FAIL（validateInput 不存在，或 execute 未更新缓存）

- [ ] **Step 3: 修改 write.ts**

完整重写 write.ts：

```typescript
// src/agent/tools/write.ts
import { Type, type Static } from "@sinclair/typebox";
import { mkdir, readFile, writeFile, stat } from "fs/promises";
import { dirname, resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";
import { checkFileSize } from './file-guard.js';

const writeSchema = Type.Object({
  file_path: Type.String({ description: "The absolute path to the file to write (must be absolute, not relative)" }),
  content: Type.String({ description: "The content to write to the file" }),
});

const writeOutputSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  filePath: Type.String(),
  content: Type.String(),
  originalFile: Type.Union([Type.String(), Type.Null()]),
});

type WriteInput = Static<typeof writeSchema>;
type WriteOutput = Static<typeof writeOutputSchema>;

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema, WriteOutput> {
  return defineAgentTool({
    name: "Write",
    label: "Write",
    description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`,
    parameters: writeSchema,
    outputSchema: writeOutputSchema,
    isDestructive: true,

    async validateInput(params, context) {
      const fullPath = resolve(cwd, params.file_path);

      // 检查文件是否存在
      let exists: boolean;
      try {
        await stat(fullPath);
        exists = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          exists = false;
        } else {
          throw e;
        }
      }

      // 文件不存在 → 允许创建（无需先读取）
      if (!exists) {
        return { ok: true };
      }

      // 文件存在 → 要求已通过 ReadTool 读取
      const readCheck = context.fileStateCache.canEdit(fullPath);
      if (!readCheck.ok) {
        return {
          ok: false,
          message: readCheck.reason,
          errorCode: readCheck.errorCode,
        };
      }

      // 脏写检测第一层
      const stats = await stat(fullPath);
      const currentMtime = Math.floor(stats.mtimeMs);
      if (currentMtime > readCheck.record.timestamp) {
        const isFullRead =
          readCheck.record.offset === undefined &&
          readCheck.record.limit === undefined;
        if (!isFullRead) {
          return {
            ok: false,
            message: 'File has been modified since read. Read it again before writing.',
            errorCode: 7,
          };
        }
        const content = await readFile(fullPath, 'utf-8').catch(() => null);
        if (content !== readCheck.record.content) {
          return {
            ok: false,
            message: 'File has been modified since read. Read it again before writing.',
            errorCode: 7,
          };
        }
      }

      return { ok: true };
    },

    async execute(_toolCallId, params, context) {
      const fullPath = resolve(cwd, params.file_path);

      // 【新增】文件大小检查（读取前）
      await checkFileSize(fullPath);

      // 读取旧内容（如果存在）
      let originalFile: string | null = null;
      try {
        originalFile = await readFile(fullPath, "utf-8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }

      // 【新增】二次脏写检测
      const record = context.fileStateCache.get(fullPath);
      const fileStats = await stat(fullPath).catch(() => null);
      if (fileStats && record) {
        const currentMtime = Math.floor(fileStats.mtimeMs);
        if (currentMtime > record.timestamp) {
          const isFullRead = record.offset === undefined && record.limit === undefined;
          const contentUnchanged = isFullRead && originalFile === record.content;
          if (!contentUnchanged) {
            throw new Error('File unexpectedly modified since last read');
          }
        }
      }

      // 创建父目录并写入
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, params.content, "utf-8");

      // 【新增】更新缓存
      const newStats = await stat(fullPath);
      context.fileStateCache.recordEdit(fullPath, params.content, Math.floor(newStats.mtimeMs));

      return {
        type: originalFile === null ? "create" : "update",
        filePath: fullPath,
        content: params.content,
        originalFile,
      };
    },

    formatResult(output, _toolCallId) {
      if (output.type === "create") {
        return [{
          type: "text" as const,
          text: `File created successfully at: ${output.filePath}`,
        }];
      }
      return [{
        type: "text" as const,
        text: `The file ${output.filePath} has been updated successfully.`,
      }];
    },
  });
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun test src/agent/tools/write.test.ts`
Expected: PASS（7 个测试全部通过）

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/write.ts src/agent/tools/write.test.ts
git commit -m "feat(write): add validateInput, dirty-write detection, cache update, file size check

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 4: EditTool 脏写集成测试

**Files:**
- Modify: `src/agent/tools/edit.test.ts`

**上下文：** 当前 22 个测试均未覆盖 errorCode 7（脏写检测）。需要使用 `fs.utimes` 模拟外部修改。

- [ ] **Step 1: 在 edit.test.ts 末尾添加脏写测试组**

```typescript
describe('EditTool dirty-write detection', () => {
  it('mtime 变化应触发 validateInput 拒绝（errorCode 7）', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/edit-dirty.txt', 'original content', 'utf-8');
    const stats = await fs.stat('/tmp/edit-dirty.txt');
    cache.recordRead('/tmp/edit-dirty.txt', 'original content', Math.floor(stats.mtimeMs));

    // 模拟外部修改并推进 mtime
    await fs.writeFile('/tmp/edit-dirty.txt', 'modified content', 'utf-8');
    const future = new Date(Date.now() + 10000);
    await fs.utimes('/tmp/edit-dirty.txt', future, future);

    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/edit-dirty.txt',
      old_string: 'original',
      new_string: 'updated',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(7);
    }

    await fs.unlink('/tmp/edit-dirty.txt').catch(() => {});
  });

  it('mtime 变化但内容未变（全量读取）应通过', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/edit-same.txt', 'same content', 'utf-8');
    const stats = await fs.stat('/tmp/edit-same.txt');
    cache.recordRead('/tmp/edit-same.txt', 'same content', Math.floor(stats.mtimeMs));

    // 只推进 mtime，不修改内容
    const future = new Date(Date.now() + 10000);
    await fs.utimes('/tmp/edit-same.txt', future, future);

    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/edit-same.txt',
      old_string: 'same',
      new_string: 'changed',
    }, mockContext(cache));

    expect(result.ok).toBe(true);
    await fs.unlink('/tmp/edit-same.txt').catch(() => {});
  });

  it('execute 中二次脏写检测应抛出异常', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/exec-dirty.txt', 'original', 'utf-8');
    const stats = await fs.stat('/tmp/exec-dirty.txt');
    cache.recordRead('/tmp/exec-dirty.txt', 'original', Math.floor(stats.mtimeMs));

    // 通过 validateInput（此时 mtime 未变）
    const tool = createEditTool('/tmp');
    const validateResult = await tool.validateInput!({
      file_path: '/tmp/exec-dirty.txt',
      old_string: 'original',
      new_string: 'updated',
    }, mockContext(cache));
    expect(validateResult.ok).toBe(true);

    // 在 validateInput 和 execute 之间模拟外部修改
    await fs.writeFile('/tmp/exec-dirty.txt', 'tampered', 'utf-8');
    const future = new Date(Date.now() + 10000);
    await fs.utimes('/tmp/exec-dirty.txt', future, future);

    // execute 应抛出异常
    await expect(tool.execute!('test-id', {
      file_path: '/tmp/exec-dirty.txt',
      old_string: 'original',
      new_string: 'updated',
    }, mockContext(cache))).rejects.toThrow('File unexpectedly modified');

    await fs.unlink('/tmp/exec-dirty.txt').catch(() => {});
  });
});
```

- [ ] **Step 2: 运行 EditTool 测试，确认通过**

Run: `bun test src/agent/tools/edit.test.ts`
Expected: PASS（9 个测试全部通过，原有 6 个 + 新增 3 个）

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/edit.test.ts
git commit -m "test(edit): add dirty-write detection integration tests

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## 回归验证

所有任务完成后，运行全量测试：

```bash
bun test src/agent/tools/
```

Expected: 所有测试通过（file-guard 4 + edit 9 + write 7 = 20 个测试）

---

## Self-Review Checklist

- [ ] **Spec coverage:** WriteTool validateInput ✓, WriteTool 脏写检测 ✓, 文件大小限制 ✓, 脏写集成测试 ✓, WriteTool 测试 ✓
- [ ] **Placeholder scan:** 无 TBD/TODO/"implement later"
- [ ] **Type consistency:** `checkFileSize` 签名一致，`errorCode` 6/7 复用现有定义
