# EditTool 对齐 cc 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EditTool 的参数结构从数组（`edits[]`）改为扁平结构（`old_string`/`new_string`/`replace_all`），对齐 cc 的 prompt、validateInput 和输出格式。

**Architecture:** 直接修改 `src/agent/tools/edit.ts` 单一文件，不引入新架构。参数扁平化后每次调用只执行一处替换。validateInput 覆盖常见错误场景（old_string===new_string、文件不存在、old_string 找不到、多匹配）。

**Tech Stack:** TypeScript, Bun, TypeBox, @sinclair/typebox

---

### 文件结构

| 文件 | 职责 | 变更 |
|---|---|---|
| `src/agent/tools/edit.ts` | EditTool 完整实现（schema、validateInput、execute、formatResult） | 重写 |

---

### Task 1: 替换参数 schema 和输出 schema

**Files:**
- Modify: `src/agent/tools/edit.ts:7-26`

- [ ] **Step 1: 替换 `replaceEditSchema` 为扁平参数结构**

删除 `replaceEditSchema`，将 `editSchema` 改为：

```typescript
const editSchema = Type.Object({
  file_path: Type.String({ description: "The absolute path to the file to modify" }),
  old_string: Type.String({ description: "The text to replace" }),
  new_string: Type.String({ description: "The text to replace it with (must be different from old_string)" }),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences of old_string (default false)" })),
});
```

- [ ] **Step 2: 替换 `editOutputSchema` 为扩展版本**

```typescript
const editOutputSchema = Type.Object({
  filePath: Type.String(),
  oldString: Type.String(),
  newString: Type.String(),
  originalFile: Type.String(),
  replaceAll: Type.Boolean(),
});
```

- [ ] **Step 3: 更新类型别名**

```typescript
type EditInput = Static<typeof editSchema>;
type EditOutput = Static<typeof editOutputSchema>;
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/tools/edit.ts
git commit -m "refactor(edit): align parameter and output schema with cc"
```

---

### Task 2: 修改工具定义 — name、prompt、validateInput、execute、formatResult

**Files:**
- Modify: `src/agent/tools/edit.ts:28-59`

- [ ] **Step 1: 替换 `createEditTool` 完整函数体**

```typescript
export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    name: "Edit",
    label: "Edit",
    description: `Performs exact string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
    parameters: editSchema,
    outputSchema: editOutputSchema,
    isDestructive: true,

    validateInput: async (params: EditInput) => {
      const fullPath = resolve(cwd, params.file_path);

      // 1. old_string === new_string
      if (params.old_string === params.new_string) {
        return {
          ok: false,
          message: "No changes to make: old_string and new_string are exactly the same.",
          errorCode: 1,
        };
      }

      // 2. 读取文件
      let content: string;
      try {
        content = await readFile(fullPath, "utf-8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          // 空 old_string 表示创建新文件 — 允许
          if (params.old_string === "") {
            return { ok: true };
          }
          return {
            ok: false,
            message: "File does not exist.",
            errorCode: 4,
          };
        }
        throw e;
      }

      // 文件存在但 old_string 为空 — 拒绝（不能创建已存在的文件）
      if (params.old_string === "") {
        return {
          ok: false,
          message: "Cannot create new file - file already exists.",
          errorCode: 3,
        };
      }

      // 3. old_string 是否存在于文件中
      if (!content.includes(params.old_string)) {
        return {
          ok: false,
          message: `String to replace not found in file.\\nString: ${params.old_string}`,
          errorCode: 8,
        };
      }

      // 4. 多匹配检测
      const matches = content.split(params.old_string).length - 1;
      if (matches > 1 && !params.replace_all) {
        return {
          ok: false,
          message: `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\\nString: ${params.old_string}`,
          errorCode: 9,
        };
      }

      return { ok: true };
    },

    async execute(_toolCallId, params, _context) {
      const fullPath = resolve(cwd, params.file_path);
      const { old_string, new_string, replace_all = false } = params;

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

      // 空 old_string 表示创建新文件
      let newContent: string;
      if (old_string === "") {
        newContent = new_string;
      } else {
        newContent = replace_all
          ? content.replaceAll(old_string, new_string)
          : content.replace(old_string, new_string);
      }

      await writeFile(fullPath, newContent, "utf-8");

      return {
        filePath: fullPath,
        oldString: old_string,
        newString: new_string,
        originalFile: content,
        replaceAll: replace_all,
      };
    },

    formatResult(output, _toolCallId) {
      if (output.replaceAll) {
        return [{
          type: "text" as const,
          text: `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`,
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

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/edit.ts
git commit -m "feat(edit): align name, prompt, validateInput, execute, formatResult with cc"
```

---

### Task 3: 类型检查与测试验证

- [ ] **Step 1: 运行类型检查**

Run: `bun run typecheck`
Expected: 0 errors

- [ ] **Step 2: 运行测试**

Run: `bun test src/`
Expected: all pass

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix(edit): typecheck and test fixes"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 工具名 `'Edit'` — Task 2 Step 1
- ✅ 参数扁平化（file_path, old_string, new_string, replace_all）— Task 1 Step 1
- ✅ Prompt 完整说明 — Task 2 Step 1
- ✅ validateInput 覆盖（old_string===new_string、文件不存在、old_string 找不到、多匹配）— Task 2 Step 1
- ✅ 输出扩展（filePath, oldString, newString, originalFile, replaceAll）— Task 1 Step 2
- ✅ formatResult 对齐 — Task 2 Step 1

**2. Placeholder scan:** 无 TBD/TODO/"implement later"。

**3. Type一致性：**
- `EditInput` 和 `EditOutput` 类型由 TypeBox schema 推导
- `validateInput` 和 `execute` 签名与 schema 一致
- `replace_all` 默认 `false`，在 execute 中使用 `?? false`
