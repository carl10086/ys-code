# WriteTool 对齐 cc 设计文档

## 目标

将 WriteTool 与 claude-code (cc) 的 FileWriteTool 对齐。参数从 `path` 改为 `file_path`，prompt 包含完整使用说明，输出扩展为区分 create/update 的结构。

## 现状与差距

| 项 | 当前 | cc |
|---|---|---|
| 工具名 | `write` | `Write` |
| 参数 | `path`, `content` | `file_path`, `content` |
| prompt | 静态短文本 "Write content to a file. Creates parent directories if needed." | 完整使用说明（先 Read、优先 Edit、不创建文档） |
| validateInput | 无（执行时直接写） | 文件是否已 Read、文件修改时间戳 |
| 输出 | `{ path, bytes }` | `{ type: 'create' \| 'update', filePath, content, originalFile }` |

## 架构

单一文件修改：

```
src/agent/tools/write.ts    # 核心实现（参数重命名、prompt、输出扩展）
```

## 核心设计

### 1. 参数 schema

```typescript
const writeSchema = Type.Object({
  file_path: Type.String({ description: "The absolute path to the file to write (must be absolute, not relative)" }),
  content: Type.String({ description: "The content to write to the file" }),
});
```

**关键变化：**
- `path` → `file_path`
- 描述明确说明必须是绝对路径

### 2. Prompt（Description）

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.
```

### 3. validateInput

一期暂不对齐 readFileState 硬性拦截（需要会话级状态追踪基础设施）。

```typescript
validateInput: async (params: WriteInput) => {
  // 仅做基本的 oldContent 检测用于区分 create/update
  return { ok: true };
}
```

### 4. 执行（execute）

```typescript
async execute(_toolCallId, params, _context) {
  const fullPath = resolve(cwd, params.file_path);
  
  // 读取旧内容（如果存在）
  let originalFile: string | null = null;
  try {
    originalFile = await readFile(fullPath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }

  // 创建父目录并写入
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, params.content, "utf-8");

  return {
    type: originalFile === null ? "create" : "update",
    filePath: fullPath,
    content: params.content,
    originalFile,
  };
}
```

### 5. 输出 schema

```typescript
const writeOutputSchema = Type.Object({
  type: Type.Union([Type.Literal("create"), Type.Literal("update")]),
  filePath: Type.String(),
  content: Type.String(),
  originalFile: Type.Union([Type.String(), Type.Null()]),
});
```

### 6. formatResult

```typescript
formatResult(output, _toolCallId) {
  if (output.type === "create") {
    return [{
      type: "text",
      text: `File created successfully at: ${output.filePath}`,
    }];
  }
  return [{
    type: "text",
    text: `The file ${output.filePath} has been updated successfully.`,
  }];
}
```

## 暂不对齐的项

| 项 | 原因 |
|---|---|
| 文件必须先 Read 的硬性拦截 | 需要 readFileState 基础设施，二期实现 |
| 文件修改时间戳检测 | 同上 |
| 结构化 patch 输出 | 需要 diff 库集成，二期实现 |
| LSP 通知 | 需要 LSP 服务架构 |
| git diff 计算 | 需要 git 集成 |
| team memory secret 检测 | 当前无此需求 |
| UNC 路径安全检测 | 当前无此需求 |

## 验收标准

1. 工具名改为 `'Write'`
2. 参数 `path` 改为 `file_path`
3. description 包含完整使用说明
4. 输出区分 `create` 和 `update`，包含 `filePath`, `content`, `originalFile`
5. `bun run typecheck` 通过
6. `bun test` 通过
