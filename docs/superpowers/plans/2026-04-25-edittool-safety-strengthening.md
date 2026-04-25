# EditTool 安全加固包实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 EditTool 和 WriteTool 中补齐编码/行尾保持、Notebook 保护、Settings 保护、相似文件建议四项安全机制。

**Architecture:** 提取编码感知读写到 `file-encoding.ts` 独立模块，供 EditTool 和 WriteTool 共用；在 EditTool `validateInput` 的合适位置插入 Notebook/Settings/相似文件检查；保持最小侵入，每项功能可独立回滚。

**Tech Stack:** TypeScript, Bun, fs/promises

---

## 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/agent/tools/file-encoding.ts` | 新增 | 编码检测、行尾检测、编码感知读写 |
| `src/agent/tools/file-encoding.test.ts` | 新增 | file-encoding.ts 的单元测试 |
| `src/agent/tools/edit.ts` | 修改 | 集成 4 项安全机制到 validateInput 和 execute |
| `src/agent/tools/edit.test.ts` | 修改 | 扩展测试覆盖新功能 |
| `src/agent/tools/write.ts` | 修改 | execute 中使用编码感知写入 |
| `src/agent/tools/write.test.ts` | 修改 | 扩展测试覆盖编码保持 |

---

## Task 1: file-encoding.ts 核心实现

**Files:**
- Create: `src/agent/tools/file-encoding.ts`
- Test: `src/agent/tools/file-encoding.test.ts`

**背景：** 当前 `readFile(path, 'utf-8')` 假设文件永远是 UTF-8 且行尾为 `\n`。本任务提取编码感知读写。

- [ ] **Step 1: 编写 file-encoding.ts**

```typescript
// src/agent/tools/file-encoding.ts
import { readFile, writeFile } from "fs/promises";

/**
 * 文件编码信息
 */
export interface FileEncoding {
  /** 文件编码格式 */
  encoding: "utf8" | "utf16le";
  /** 原始行尾符 */
  lineEndings: "\n" | "\r\n";
}

/**
 * 编码感知读取结果
 */
export interface ReadResult {
  /** 文件内容（内部统一为 \n） */
  content: string;
  /** 原始编码信息 */
  encoding: FileEncoding;
}

/**
 * 检测文件编码（通过 BOM）
 * @param buffer 文件原始 Buffer
 * @returns 编码格式
 */
function detectEncoding(buffer: Buffer): "utf8" | "utf16le" {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }
  return "utf8";
}

/**
 * 检测行尾符
 * @param content 原始文件内容
 * @returns 行尾符类型
 */
function detectLineEndings(content: string): "\n" | "\r\n" {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/\n/g) || []).length - crlfCount;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

/**
 * 读取文件，自动检测编码和行尾，内部统一为 \n
 * @param path 文件路径
 * @returns 读取结果
 */
export async function readFileWithEncoding(path: string): Promise<ReadResult> {
  const buffer = await readFile(path);
  const encoding = detectEncoding(buffer);
  let content = buffer.toString(encoding);
  const lineEndings = detectLineEndings(content);
  content = content.replaceAll("\r\n", "\n");
  return { content, encoding: { encoding, lineEndings } };
}

/**
 * 写入文件，保持原始编码和行尾
 * @param path 文件路径
 * @param content 内容（内部使用 \n）
 * @param encoding 原始编码信息
 */
export async function writeFileWithEncoding(
  path: string,
  content: string,
  encoding: FileEncoding,
): Promise<void> {
  let finalContent = content;
  if (encoding.lineEndings === "\r\n") {
    finalContent = content.replaceAll("\n", "\r\n");
  }
  const buffer = Buffer.from(finalContent, encoding.encoding);
  await writeFile(path, buffer);
}
```

- [ ] **Step 2: 编写基础测试用例**

```typescript
// src/agent/tools/file-encoding.test.ts
import { describe, it, expect } from "bun:test";
import { writeFile, readFile, unlink } from "fs/promises";
import { readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";
import { join } from "path";
import { tmpdir } from "os";

function tempPath(name: string): string {
  return join(tmpdir(), `ys-test-${Date.now()}-${name}`);
}

describe("readFileWithEncoding", () => {
  it("读取 UTF-8 + LF", async () => {
    const path = tempPath("utf8-lf.txt");
    await writeFile(path, "hello\nworld", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("hello\nworld");
      expect(result.encoding.encoding).toBe("utf8");
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("读取 UTF-8 + CRLF", async () => {
    const path = tempPath("utf8-crlf.txt");
    await writeFile(path, "hello\r\nworld", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("hello\nworld");
      expect(result.encoding.encoding).toBe("utf8");
      expect(result.encoding.lineEndings).toBe("\r\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("读取 UTF-16 LE + BOM + LF", async () => {
    const path = tempPath("utf16-lf.txt");
    const buffer = Buffer.from([0xff, 0xfe, ...Buffer.from("hello\nworld", "utf16le")]);
    await writeFile(path, buffer);
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("hello\nworld");
      expect(result.encoding.encoding).toBe("utf16le");
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});

describe("writeFileWithEncoding", () => {
  it("恢复 CRLF", async () => {
    const path = tempPath("write-crlf.txt");
    try {
      await writeFileWithEncoding(path, "hello\nworld", { encoding: "utf8", lineEndings: "\r\n" });
      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("hello\r\nworld");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("恢复 UTF-16", async () => {
    const path = tempPath("write-utf16.txt");
    try {
      await writeFileWithEncoding(path, "hello", { encoding: "utf16le", lineEndings: "\n" });
      const raw = await readFile(path);
      expect(raw[0]).toBe(0xff);
      expect(raw[1]).toBe(0xfe);
      const content = raw.toString("utf16le").replace(/^﻿/, "");
      expect(content).toBe("hello");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/agent/tools/file-encoding.test.ts`
Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/agent/tools/file-encoding.ts src/agent/tools/file-encoding.test.ts
git commit -m "feat(file-encoding): add encoding-aware read/write with line-ending preservation"
```

---

## Task 2: file-encoding.ts 边界情况

**Files:**
- Modify: `src/agent/tools/file-encoding.test.ts`

- [ ] **Step 1: 添加边界测试**

在 `file-encoding.test.ts` 的 `describe("readFileWithEncoding")` 中添加：

```typescript
  it("空文件默认 utf8 + \\n", async () => {
    const path = tempPath("empty.txt");
    await writeFile(path, "");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("");
      expect(result.encoding.encoding).toBe("utf8");
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("混合行尾（\\r\\n 占多数）", async () => {
    const path = tempPath("mixed-crlf.txt");
    // 3 个 CRLF, 1 个 LF
    await writeFile(path, "a\r\nb\r\nc\r\nd\ne", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.encoding.lineEndings).toBe("\r\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("混合行尾（\\n 占多数）", async () => {
    const path = tempPath("mixed-lf.txt");
    // 1 个 CRLF, 3 个 LF
    await writeFile(path, "a\r\nb\nc\nd\ne", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
```

- [ ] **Step 2: 运行测试**

Run: `bun test src/agent/tools/file-encoding.test.ts`
Expected: 8 tests PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/file-encoding.test.ts
git commit -m "test(file-encoding): add edge case tests for empty files and mixed line endings"
```

---

## Task 3: Notebook 保护

**Files:**
- Modify: `src/agent/tools/edit.ts`
- Test: `src/agent/tools/edit.test.ts`

- [ ] **Step 1: 在 edit.test.ts 中添加 Notebook 保护测试**

在 `edit.test.ts` 中找一个合适的位置（例如在"文件不存在"测试组附近）添加：

```typescript
describe("Notebook 保护", () => {
  it("拒绝编辑 .ipynb 文件", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    const notebookPath = join(cwd, "test.ipynb");
    await writeFile(notebookPath, '{"cells": []}', "utf-8");
    cache.recordRead(notebookPath, '{"cells": []}', Date.now());

    try {
      const result = await tool.validateInput!({
        file_path: notebookPath,
        old_string: "cells",
        new_string: "nodes",
      }, buildContext(cache));
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5);
      expect(result.message).toContain("NotebookEditTool");
    } finally {
      await unlink(notebookPath).catch(() => {});
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/tools/edit.test.ts -t "拒绝编辑 .ipynb 文件"`
Expected: FAIL（errorCode 不是 5，而是 8 或其他）

- [ ] **Step 3: 在 edit.ts 中添加 Notebook 保护**

在 `edit.ts` 的 `validateInput` 中，找到"文件大小检查之后、读取文件内容之前"的位置（约第 169 行），插入：

```typescript
      // 【新增】Notebook 保护
      if (fullPath.endsWith(".ipynb")) {
        return {
          ok: false,
          message: "Jupyter notebooks must be edited with a specialized tool. Use NotebookEditTool instead.",
          errorCode: 5,
        };
      }
```

具体位置：在 `await checkFileSize(fullPath);` 之后、`let content: string;` 之前。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/tools/edit.test.ts -t "拒绝编辑 .ipynb 文件"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit): reject .ipynb edits with error code 5"
```

---

## Task 4: Settings 保护（JSON 合法性校验）

**Files:**
- Modify: `src/agent/tools/edit.ts`
- Test: `src/agent/tools/edit.test.ts`

- [ ] **Step 1: 在 edit.test.ts 中添加 Settings 保护测试**

```typescript
describe("Settings 保护", () => {
  it("允许产生合法 JSON 的编辑", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    const jsonPath = join(cwd, "settings.json");
    const content = '{"name": "old", "value": 1}';
    await writeFile(jsonPath, content, "utf-8");
    cache.recordRead(jsonPath, content, Date.now());

    try {
      const result = await tool.validateInput!({
        file_path: jsonPath,
        old_string: '"name": "old"',
        new_string: '"name": "new"',
      }, buildContext(cache));
      expect(result.ok).toBe(true);
    } finally {
      await unlink(jsonPath).catch(() => {});
    }
  });

  it("拒绝产生非法 JSON 的编辑", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    const jsonPath = join(cwd, "settings.json");
    const content = '{"name": "old", "value": 1}';
    await writeFile(jsonPath, content, "utf-8");
    cache.recordRead(jsonPath, content, Date.now());

    try {
      const result = await tool.validateInput!({
        file_path: jsonPath,
        old_string: '"name": "old"',
        new_string: '"name": "new",',  // 尾部多余逗号导致非法 JSON
      }, buildContext(cache));
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(11);
      expect(result.message).toContain("invalid JSON");
    } finally {
      await unlink(jsonPath).catch(() => {});
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/tools/edit.test.ts -t "拒绝产生非法 JSON 的编辑"`
Expected: FAIL（errorCode 不是 11）

- [ ] **Step 3: 在 edit.ts 中添加 JSON 合法性校验**

在 `validateInput` 的末尾，返回 `{ ok: true }` 之前（约第 219 行），插入：

```typescript
      // 【新增】Settings 保护：JSON 文件编辑后必须仍是合法 JSON
      if (fullPath.endsWith(".json")) {
        let preview: string;
        if (params.old_string === "") {
          preview = params.new_string;
        } else {
          const actualNewString = preserveQuoteStyle(params.old_string, actualOldString!, params.new_string);
          preview = params.replace_all
            ? content.replaceAll(actualOldString!, actualNewString)
            : content.replace(actualOldString!, actualNewString);
        }
        try {
          JSON.parse(preview);
        } catch {
          return {
            ok: false,
            message: "Edit would result in invalid JSON. Please check your new_string.",
            errorCode: 11,
          };
        }
      }
```

注意：`actualOldString` 在此处已经被确认为非 null（前面的检查已通过）。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/tools/edit.test.ts -t "Settings 保护"`
Expected: 2 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit): validate JSON syntax after edit for .json files (error code 11)"
```

---

## Task 5: 相似文件建议

**Files:**
- Modify: `src/agent/tools/edit.ts`
- Test: `src/agent/tools/edit.test.ts`

- [ ] **Step 1: 在 edit.ts 顶部添加导入**

```typescript
import { readdir } from "fs/promises";
```

- [ ] **Step 2: 在 edit.ts 中添加 findSimilarFile 函数**

在 `preserveQuoteStyle` 函数之后、`editSchema` 之前，添加：

```typescript
/**
 * 查找相似文件名（简单启发式）
 * @param targetPath 目标文件路径
 * @returns 相似文件名或 null
 */
async function findSimilarFile(targetPath: string): Promise<string | null> {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const candidates = files.filter((f) => !f.startsWith("."));
  if (candidates.length === 0) return null;

  // 策略 1：前缀匹配（前 3 个字符相同）
  const prefix = base.slice(0, 3).toLowerCase();
  const prefixMatch = candidates.find((f) =>
    f.toLowerCase().startsWith(prefix)
  );
  if (prefixMatch) return prefixMatch;

  // 策略 2：去掉扩展名后互相包含
  const targetNoExt = base.replace(/\.[^.]+$/, "").toLowerCase();
  const containmentMatch = candidates.find((f) => {
    const fNoExt = f.replace(/\.[^.]+$/, "").toLowerCase();
    return fNoExt.includes(targetNoExt) || targetNoExt.includes(fNoExt);
  });
  if (containmentMatch) return containmentMatch;

  return null;
}
```

- [ ] **Step 3: 修改文件不存在时的错误消息**

在 `validateInput` 中，找到文件不存在时的返回逻辑（约第 176-186 行）：

```typescript
      // 7. 文件不存在处理
      if (fileContent === null) {
        if (old_string === '') return { ok: true };
        const similar = await findSimilarFile(fullPath);
        const message = similar
          ? `File does not exist. Did you mean: ${similar}?`
          : "File does not exist.";
        return {
          ok: false,
          message,
          errorCode: 4,
        };
      }
```

- [ ] **Step 4: 在 edit.test.ts 中添加相似文件建议测试**

```typescript
describe("相似文件建议", () => {
  it("文件不存在且存在相似文件时给出建议", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    // 先创建一个相似文件
    const similarPath = join(cwd, "edit.ts");
    await writeFile(similarPath, "content", "utf-8");

    try {
      const result = await tool.validateInput!({
        file_path: join(cwd, "editt.ts"),  // 拼写错误
        old_string: "foo",
        new_string: "bar",
      }, buildContext(cache));
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(4);
      expect(result.message).toContain("Did you mean");
      expect(result.message).toContain("edit.ts");
    } finally {
      await unlink(similarPath).catch(() => {});
    }
  });

  it("文件不存在且无相似文件时不给建议", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    const result = await tool.validateInput!({
      file_path: join(cwd, "xyz-unique-name-12345.ts"),
      old_string: "foo",
      new_string: "bar",
    }, buildContext(cache));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(4);
    expect(result.message).not.toContain("Did you mean");
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `bun test src/agent/tools/edit.test.ts -t "相似文件建议"`
Expected: 2 tests PASS

- [ ] **Step 6: 提交**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit): suggest similar filenames when file does not exist"
```

---

## Task 6: EditTool 编码/行尾集成

**Files:**
- Modify: `src/agent/tools/edit.ts`
- Test: `src/agent/tools/edit.test.ts`

- [ ] **Step 1: 修改 edit.ts 导入和读取逻辑**

在 `edit.ts` 顶部添加导入：

```typescript
import { readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";
```

修改 `validateInput` 中的文件读取（约第 172-188 行）：

```typescript
      // 读取文件（编码感知）
      let content: string;
      let fileEncoding: { encoding: "utf8" | "utf16le"; lineEndings: "\n" | "\r\n" };
      try {
        const result = await readFileWithEncoding(fullPath);
        content = result.content;
        fileEncoding = result.encoding;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          if (params.old_string === "") {
            return { ok: true };
          }
          const similar = await findSimilarFile(fullPath);
          const message = similar
            ? `File does not exist. Did you mean: ${similar}?`
            : "File does not exist.";
          return {
            ok: false,
            message,
            errorCode: 4,
          };
        }
        throw e;
      }
```

注意：`fileEncoding` 变量需要在当前作用域声明，但 execute 阶段需要重新读取，所以不需要传递给 execute。

- [ ] **Step 2: 修改 edit.ts execute 中的读写逻辑**

在 `execute` 中（约第 222-234 行），将：

```typescript
      let content: string;
      try {
        content = await readFile(fullPath, "utf-8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          content = "";
        } else {
          throw e;
        }
      }
```

改为：

```typescript
      let content: string;
      let fileEncoding: { encoding: "utf8" | "utf16le"; lineEndings: "\n" | "\r\n" } = {
        encoding: "utf8",
        lineEndings: "\n",
      };
      try {
        const result = await readFileWithEncoding(fullPath);
        content = result.content;
        fileEncoding = result.encoding;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          content = "";
        } else {
          throw e;
        }
      }
```

并将写入（约第 265 行）：

```typescript
      await writeFile(fullPath, newContent, "utf-8");
```

改为：

```typescript
      await writeFileWithEncoding(fullPath, newContent, fileEncoding);
```

- [ ] **Step 3: 在 edit.test.ts 中添加编码保持测试**

```typescript
describe("编码/行尾保持", () => {
  it("编辑后保持 CRLF 行尾", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    const path = join(cwd, "crlf.txt");
    await writeFile(path, "hello\r\nworld", "utf-8");
    cache.recordRead(path, "hello\r\nworld", Date.now());

    try {
      await tool.execute!("test", {
        file_path: path,
        old_string: "hello",
        new_string: "hi",
      }, buildContext(cache));

      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("hi\r\nworld");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("编辑后保持 UTF-16 编码", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cwd);
    const path = join(cwd, "utf16.txt");
    const buffer = Buffer.from([0xff, 0xfe, ...Buffer.from("hello\nworld", "utf16le")]);
    await writeFile(path, buffer);
    cache.recordRead(path, "hello\nworld", Date.now());

    try {
      await tool.execute!("test", {
        file_path: path,
        old_string: "hello",
        new_string: "hi",
      }, buildContext(cache));

      const raw = await readFile(path);
      expect(raw[0]).toBe(0xff);
      expect(raw[1]).toBe(0xfe);
      const content = raw.toString("utf16le").replace(/^﻿/, "");
      expect(content).toBe("hi\nworld");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `bun test src/agent/tools/edit.test.ts -t "编码/行尾保持"`
Expected: 2 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit): preserve file encoding and line endings on edit"
```

---

## Task 7: WriteTool 编码/行尾集成

**Files:**
- Modify: `src/agent/tools/write.ts`
- Test: `src/agent/tools/write.test.ts`

- [ ] **Step 1: 修改 write.ts 导入和读取逻辑**

在 `write.ts` 顶部添加导入：

```typescript
import { readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";
```

修改 `execute` 中的读取逻辑（约第 100-110 行）：

```typescript
      let originalFile: string | null = null;
      let fileEncoding: { encoding: "utf8" | "utf16le"; lineEndings: "\n" | "\r\n" } = {
        encoding: "utf8",
        lineEndings: "\n",
      };
      try {
        const result = await readFileWithEncoding(fullPath);
        originalFile = result.content;
        fileEncoding = result.encoding;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }
```

并将写入（约第 126 行）：

```typescript
      await writeFile(fullPath, params.content, "utf-8");
```

改为：

```typescript
      await writeFileWithEncoding(fullPath, params.content, fileEncoding);
```

- [ ] **Step 2: 在 write.test.ts 中添加编码保持测试**

```typescript
describe("编码/行尾保持", () => {
  it("覆盖文件时保持 CRLF 行尾", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool(cwd);
    const path = join(cwd, "write-crlf.txt");
    await writeFile(path, "original\r\ncontent", "utf-8");
    cache.recordRead(path, "original\r\ncontent", Date.now());

    try {
      await tool.execute!("test", {
        file_path: path,
        content: "new\ncontent",
      }, buildContext(cache));

      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("new\r\ncontent");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("覆盖文件时保持 UTF-16 编码", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool(cwd);
    const path = join(cwd, "write-utf16.txt");
    const buffer = Buffer.from([0xff, 0xfe, ...Buffer.from("original", "utf16le")]);
    await writeFile(path, buffer);
    cache.recordRead(path, "original", Date.now());

    try {
      await tool.execute!("test", {
        file_path: path,
        content: "new",
      }, buildContext(cache));

      const raw = await readFile(path);
      expect(raw[0]).toBe(0xff);
      expect(raw[1]).toBe(0xfe);
      const content = raw.toString("utf16le").replace(/^﻿/, "");
      expect(content).toBe("new");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("创建新文件使用默认编码", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool(cwd);
    const path = join(cwd, "new-file.txt");

    try {
      await tool.execute!("test", {
        file_path: path,
        content: "hello\nworld",
      }, buildContext(cache));

      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("hello\nworld");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/agent/tools/write.test.ts -t "编码/行尾保持"`
Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/agent/tools/write.ts src/agent/tools/write.test.ts
git commit -m "feat(write): preserve file encoding and line endings on overwrite"
```

---

## Task 8: 回归测试与最终提交

**Files:**
- All test files

- [ ] **Step 1: 运行全部相关测试**

Run: `bun test src/agent/tools/file-encoding.test.ts src/agent/tools/edit.test.ts src/agent/tools/write.test.ts`
Expected: 所有测试 PASS

- [ ] **Step 2: 运行完整测试套件**

Run: `bun test`
Expected: 所有测试 PASS（确认无回归）

- [ ] **Step 3: 最终提交（如有未提交的修改）**

```bash
git status
# 确认所有修改已提交
```

---

## Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 编码/行尾保持模块 | Task 1, 2, 6, 7 |
| Notebook 保护 | Task 3 |
| Settings 保护（JSON 校验） | Task 4 |
| 相似文件建议 | Task 5 |
| 回归测试 | Task 8 |

**无遗漏。**

## Placeholder 扫描

- 无 "TBD", "TODO", "implement later"
- 无 "add appropriate error handling" 等模糊描述
- 所有代码块包含完整代码
- 所有命令包含预期输出
