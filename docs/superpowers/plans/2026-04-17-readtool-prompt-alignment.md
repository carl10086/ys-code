# ReadTool Prompt & 参数对齐 cc 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ReadTool 的 name、参数名、description、prepareArguments 与 claude-code (cc) 的 FileReadTool 完全对齐。

**Architecture:** 直接修改现有文件，不涉及架构变更。主要改动：工具名从 `'read'` 改为 `'Read'`，参数 `path` 改为 `file_path`，description 改为 cc 的完整 prompt，并添加 `prepareArguments` 实现 semanticNumber。

**Tech Stack:** TypeScript, Bun, TypeBox, @sinclair/typebox

---

### Task 1: 修改 ReadInput 类型定义

**Files:**
- Modify: `src/agent/tools/read/types.ts:1-8`

- [ ] **Step 1: 将 `path` 字段改为 `file_path`**

```typescript
// 修改前
export interface ReadInput {
  path: string;           // 文件路径（相对或绝对）
  offset?: number;        // 起始行号（1-indexed）
  limit?: number;         // 最大读取行数
  pages?: string;         // PDF 页面范围（如 "1-5"）
}

// 修改后
export interface ReadInput {
  file_path: string;      // 文件路径（相对或绝对）
  offset?: number;        // 起始行号（1-indexed）
  limit?: number;         // 最大读取行数
  pages?: string;         // PDF 页面范围（如 "1-5"）
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/read/types.ts
git commit -m "refactor(read): ReadInput path -> file_path"
```

---

### Task 2: 修改 read.ts — 工具名、参数、description、prepareArguments

**Files:**
- Modify: `src/agent/tools/read/read.ts`

- [ ] **Step 1: 修改参数 schema**

将 `path` 改为 `file_path`，并将所有参数描述改为 cc 的英文描述：

```typescript
// 修改前
const readSchema = Type.Object({
  path: Type.String({ description: '文件路径（相对或绝对路径）' }),
  offset: Type.Optional(Type.Number({ description: '起始行号（1-indexed）' })),
  limit: Type.Optional(Type.Number({ description: '最大读取行数' })),
  pages: Type.Optional(Type.String({ description: 'PDF 页面范围（如 "1-5"）' })),
});

// 修改后
const readSchema = Type.Object({
  file_path: Type.String({ description: 'The absolute path to the file to read' }),
  offset: Type.Optional(Type.Number({ description: 'The line number to start reading from. Only provide if the file is too large to read at once' })),
  limit: Type.Optional(Type.Number({ description: 'The number of lines to read. Only provide if the file is too large to read at once.' })),
  pages: Type.Optional(Type.String({ description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.' })),
});
```

- [ ] **Step 2: 修改 createReadTool 返回的 defineAgentTool 配置**

完整替换 `createReadTool` 函数体：

```typescript
export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    name: 'Read',
    label: 'Read',
    description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    prepareArguments: (args: unknown) => {
      const parsed = args as Record<string, unknown>;
      if (typeof parsed.offset === 'string' && /^\d+$/.test(parsed.offset)) {
        parsed.offset = Number(parsed.offset);
      }
      if (typeof parsed.limit === 'string' && /^\d+$/.test(parsed.limit)) {
        parsed.limit = Number(parsed.limit);
      }
      return parsed as ReadInput;
    },

    validateInput: async (params: ReadInput) => {
      const result = await validateReadInput(params.file_path, cwd);

      // 额外校验 PDF pages 参数
      if (params.pages !== undefined) {
        const { parsePDFPageRange } = await import('./pdf.js');
        const parsed = parsePDFPageRange(params.pages);
        if (!parsed) {
          return {
            ok: false,
            message: `Invalid pages format: "${params.pages}". Use "1-5", "3", or "10-20".",
            errorCode: 8,
          };
        }
      }

      return result;
    },

    execute: async (_toolCallId: string, params: ReadInput): Promise<ReadOutput> => {
      const fullPath = expandPath(params.file_path, cwd);
      const ext = extname(fullPath).toLowerCase().slice(1);
      const offset = params.offset ?? 1;

      return readFileByType(
        fullPath,
        ext,
        offset,
        params.limit,
        params.pages,
        DEFAULT_LIMITS.maxSizeBytes,
        DEFAULT_LIMITS.maxTokens,
      );
    },

    formatResult: (output: ReadOutput, _toolCallId: string) => {
      switch (output.type) {
        case 'image':
          return [{
            type: 'image',
            data: output.file.base64,
            mimeType: output.file.mediaType,
          }];
        case 'pdf':
          return [{
            type: 'text',
            text: `PDF: ${output.file.filePath} (${output.file.originalSize} bytes, base64 encoded)`,
          }];
        case 'notebook':
          return [{
            type: 'text',
            text: `Notebook: ${output.file.filePath}\nCells: ${output.file.cells.length}`,
          }];
        case 'parts':
          return [{
            type: 'text',
            text: `PDF pages extracted: ${output.file.count} pages from ${output.file.filePath}`,
          }];
        case 'file_unchanged':
          return [{
            type: 'text',
            text: `File unchanged since last read: ${output.file.filePath}`,
          }];
        case 'text':
        default:
          return [{ type: 'text', text: output.file.content || '' }];
      }
    },
  });
}
```

**注意：** `validateInput` 中的 `params.path` 需要改为 `params.file_path`，`execute` 中的 `params.path` 也需要改为 `params.file_path`。

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/read/read.ts
git commit -m "refactor(read): align name, params, description, prepareArguments with cc"
```

---

### Task 3: 更新 format.test.ts 中的测试用例

**Files:**
- Modify: `src/cli/__tests__/format.test.ts:48-58`

- [ ] **Step 1: 更新工具名和参数名**

```typescript
// 修改前
  it("formatToolStart", () => {
    expect(formatToolStart("read_file", { path: "src/main.ts" })).toBe('-\u003e read_file(path: "src/main.ts")\n');
  });

  it("formatToolEnd 成功", () => {
    expect(formatToolEnd("read_file", false, "1.2KB", 300)).toBe("OK read_file -\u003e 1.2KB 0.3s\n");
  });

  it("formatToolEnd 失败", () => {
    expect(formatToolEnd("read_file", true, "ENOENT", 100)).toBe("ERR read_file -\u003e ENOENT 0.1s\n");
  });

// 修改后
  it("formatToolStart", () => {
    expect(formatToolStart("Read", { file_path: "src/main.ts" })).toBe('-\u003e Read(file_path: "src/main.ts")\n');
  });

  it("formatToolEnd 成功", () => {
    expect(formatToolEnd("Read", false, "1.2KB", 300)).toBe("OK Read -\u003e 1.2KB 0.3s\n");
  });

  it("formatToolEnd 失败", () => {
    expect(formatToolEnd("Read", true, "ENOENT", 100)).toBe("ERR Read -\u003e ENOENT 0.1s\n");
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/__tests__/format.test.ts
git commit -m "test(cli): update format tests for Read tool rename"
```

---

### Task 4: 类型检查与测试验证

- [ ] **Step 1: 运行类型检查**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 2: 运行测试**

```bash
bun test
```

Expected: all pass

- [ ] **Step 3: Commit（如有需要）**

如果类型检查或测试中发现问题，修复后 commit。

---

## Self-Review

**1. Spec coverage:**
- ✅ 工具名 `'Read'` — Task 2 Step 2
- ✅ 参数 `file_path` — Task 1 + Task 2 Step 1
- ✅ description 完整 prompt — Task 2 Step 2
- ✅ 参数描述英文 — Task 2 Step 1
- ✅ prepareArguments semanticNumber — Task 2 Step 2
- ✅ format.test.ts 更新 — Task 3

**2. Placeholder scan:** 无 TBD/TODO/"implement later"。

**3. Type consistency：**
- `ReadInput.file_path` 在 Task 1 定义，Task 2 中 `validateInput` 和 `execute` 均使用 `params.file_path`
- `prepareArguments` 返回类型为 `ReadInput`，与 `validateInput`/`execute` 的参数类型一致
