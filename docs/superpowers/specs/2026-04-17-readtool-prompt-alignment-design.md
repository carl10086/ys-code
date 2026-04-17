# ReadTool Prompt & 参数对齐 cc 设计文档

## 目标

将 ReadTool 的 prompt、参数名、参数描述与 claude-code (cc) 的 FileReadTool 保持完全一致。

## 背景

Phase 2 已实现图片/PDF/Notebook 支持，但以下项仍未对齐 cc：

| 项 | 当前 | cc (FileReadTool) |
|---|---|---|
| 工具名 | `read` | `Read` |
| 文件路径参数 | `path` | `file_path` |
| description | 静态短文本 | 详细的使用说明 prompt |
| 参数描述 | 中文/简单 | 英文/cc 风格 |
| offset/limit 类型 | 仅数字 | `semanticNumber`（也接受字符串数字） |

## 设计

### 1. 工具名与参数名

```typescript
// 工具名
name: 'Read',  // 从 'read' 改为 'Read'

// 参数 schema
const readSchema = Type.Object({
  file_path: Type.String({ description: 'The absolute path to the file to read' }),
  offset: Type.Optional(Type.Number({ description: 'The line number to start reading from. Only provide if the file is too large to read at once' })),
  limit: Type.Optional(Type.Number({ description: 'The number of lines to read. Only provide if the file is too large to read at once.' })),
  pages: Type.Optional(Type.String({ description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.' })),
});
```

### 2. Description（Prompt）

采用静态长描述，完整对齐 cc 的 `renderPromptTemplate` 输出：

```
Reads a file from the local filesystem. You can access any file directly by using this tool.
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
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
```

### 3. SemanticNumber（prepareArguments）

通过 `prepareArguments` 实现 cc 的 `semanticNumber` 效果：

```typescript
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
```

### 4. 内部引用更新

- `read.ts` 内部所有 `params.path` → `params.file_path`
- `validation.ts` 中的 `validateReadInput` 参数名保持不变（内部函数）
- `types.ts` 中的 `ReadInput` 类型字段名更新

## 暂不对齐的项

以下项需要扩展 `AgentTool`/`Tool` 类型定义，当前阶段 YAGNI：

| 项 | 原因 |
|---|---|
| `searchHint` | 无消费者 |
| `strict` | 无消费者 |
| `maxResultSizeChars` | 无消费者 |
| `description()` 短文本 + `prompt()` 长文本分离 | 当前架构只有一个 `description` |

## 验收标准

1. `name` 为 `'Read'`
2. 参数 `file_path` 替代 `path`
3. `description` 与 cc prompt 完全一致
4. 参数描述与 cc 完全一致
5. `offset`/`limit` 接受字符串数字
6. `bun run typecheck` 通过
7. `bun test` 通过
