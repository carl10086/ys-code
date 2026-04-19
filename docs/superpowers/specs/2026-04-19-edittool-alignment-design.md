# EditTool 对齐 cc 设计文档

## 目标

将 EditTool 与 claude-code (cc) 的 FileEditTool 对齐。采用扁平参数结构（每次调用只做一处替换），包含完整的 prompt、validateInput 校验和输出扩展。暂不对齐文件状态追踪、LSP 通知、结构化 patch 生成等高级功能。

## 现状与差距

| 项 | 当前 | cc |
|---|---|---|
| 工具名 | `edit` | `Edit` |
| 参数结构 | `path` + `edits[]`（oldText/newText） | `file_path` + `old_string` + `new_string` + `replace_all` |
| prompt | 静态短文本 "Edit a file by replacing exact text segments." | 完整使用说明（先 Read、保留缩进、唯一性规则、replace_all 用法） |
| validateInput | 无（执行时校验） | old_string===new_string、文件不存在、old_string 不存在、多匹配检测 |
| 输出 | `{ path, edits }` | `{ filePath, oldString, newString, originalFile, structuredPatch, ... }` |

## 架构

单一文件修改：

```
src/agent/tools/edit.ts    # 核心实现（参数扁平化、prompt、validateInput、输出扩展）
```

## 核心设计

### 1. 参数 schema

```typescript
const editSchema = Type.Object({
  file_path: Type.String({ description: 'The absolute path to the file to modify' }),
  old_string: Type.String({ description: 'The text to replace' }),
  new_string: Type.String({ description: 'The text to replace it with (must be different from old_string)' }),
  replace_all: Type.Optional(Type.Boolean({ description: 'Replace all occurrences of old_string (default false)' })),
});
```

**关键变化：**
- `path` → `file_path`
- 移除 `edits[]` 嵌套数组，改为扁平的 `old_string` + `new_string` + `replace_all`
- 每次调用只执行一处替换

### 2. Prompt（Description）

```
Performs exact string replacements in files.

Usage:
- You must use the Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
```

### 3. validateInput

```typescript
validateInput: async (params: EditInput) => {
  const fullPath = resolve(cwd, params.file_path);

  // 1. old_string === new_string
  if (params.old_string === params.new_string) {
    return {
      ok: false,
      message: 'No changes to make: old_string and new_string are exactly the same.',
      errorCode: 1,
    };
  }

  // 2. 读取文件
  let content: string;
  try {
    content = await readFile(fullPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // 空 old_string 表示创建新文件 — 允许
      if (params.old_string === '') {
        return { ok: true };
      }
      return {
        ok: false,
        message: `File does not exist.`,
        errorCode: 4,
      };
    }
    throw e;
  }

  // 文件存在但 old_string 为空 — 拒绝（不能创建已存在的文件）
  if (params.old_string === '') {
    return {
      ok: false,
      message: 'Cannot create new file - file already exists.',
      errorCode: 3,
    };
  }

  // 3. old_string 是否存在于文件中
  if (!content.includes(params.old_string)) {
    return {
      ok: false,
      message: `String to replace not found in file.\nString: ${params.old_string}`,
      errorCode: 8,
    };
  }

  // 4. 多匹配检测
  const matches = content.split(params.old_string).length - 1;
  if (matches > 1 && !params.replace_all) {
    return {
      ok: false,
      message: `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: ${params.old_string}`,
      errorCode: 9,
    };
  }

  return { ok: true };
}
```

**errorCode 映射（对齐 cc）：**

| errorCode | 场景 |
|---|---|
| 1 | old_string === new_string |
| 3 | 空 old_string 但文件已存在（拒绝创建） |
| 4 | 文件不存在且 old_string 非空 |
| 8 | old_string 在文件中找不到 |
| 9 | 多匹配但 replace_all=false |

### 4. 执行（execute）

```typescript
async execute(toolCallId, params, context) {
  const fullPath = resolve(cwd, params.file_path);
  const content = await readFile(fullPath, 'utf-8');

  const { old_string, new_string, replace_all = false } = params;

  // 空 old_string 表示创建新文件
  let newContent: string;
  if (old_string === '') {
    newContent = new_string;
  } else {
    newContent = replace_all
      ? content.replaceAll(old_string, new_string)
      : content.replace(old_string, new_string);
  }

  await writeFile(fullPath, newContent, 'utf-8');

  return {
    filePath: fullPath,
    oldString: old_string,
    newString: new_string,
    originalFile: content,
    replaceAll: replace_all,
  };
}
```

### 5. 输出 schema

```typescript
const editOutputSchema = Type.Object({
  filePath: Type.String(),
  oldString: Type.String(),
  newString: Type.String(),
  originalFile: Type.String(),
  replaceAll: Type.Boolean(),
});
```

### 6. formatResult

```typescript
formatResult(output, _toolCallId) {
  if (output.replaceAll) {
    return [{
      type: 'text',
      text: `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`,
    }];
  }
  return [{
    type: 'text',
    text: `The file ${output.filePath} has been updated successfully.`,
  }];
}
```

## 暂不对齐的项

| 项 | 原因 |
|---|---|
| 文件必须先 Read（readFileState 追踪） | 需要会话级文件状态追踪系统，二期实现 |
| 文件修改时间戳检测 | 同上，需要状态追踪 |
| `findActualString` 引号标准化 | 内部优化，非核心功能 |
| 结构化 patch 输出（hunk 数组） | 需要 diff 库集成，二期实现 |
| LSP 通知 | 需要 LSP 服务架构，非当前阶段 |
| VSCode diff 通知 | 需要 IDE 集成 |
| git diff 计算 | 需要 git 集成 |
| settings 文件特殊校验 | 当前无此需求 |
| team memory secret 检测 | 当前无此需求 |
| UNC 路径安全检测 | 当前无此需求 |
| 文件大小限制（1GiB） | 当前无此需求 |
| `.ipynb` 特殊处理 | 当前无此需求 |

## 验收标准

1. 工具名改为 `'Edit'`
2. 参数为扁平结构：`file_path`, `old_string`, `new_string`, `replace_all`
3. description 包含完整使用说明
4. validateInput 覆盖：old_string===new_string、文件不存在、old_string 找不到、多匹配
5. 输出包含：`filePath`, `oldString`, `newString`, `originalFile`, `replaceAll`
6. `bun run typecheck` 通过
7. `bun test` 通过
