# cc EditTool 源码分析

> **分析对象**：claude-code-haha（cc）的 `FileEditTool`
> **分析日期**：2026-04-23
> **文档版本**：v2（统一分析框架）
> **目标**：理解 cc 的文件编辑安全机制与执行链路，为 ys-code 提供设计参考

---

## 1. 背景与定位

### 1.1 分析对象

claude-code-haha（以下简称 "cc"）是 Anthropic 官方 Claude Code CLI 的参考实现，其 `FileEditTool` 是核心的文件编辑工具，负责处理所有文本文件的修改操作。

### 1.2 设计目标

cc 的 `FileEditTool` 围绕三个核心目标设计：

1. **安全性**：防止模型在不了解文件内容的情况下盲目编辑（Read-before-Write）
2. **可靠性**：防止外部工具（Vim、IDE、linter）在读取后修改文件导致的脏写
3. **用户体验**：提供清晰的 diff 预览、引号规范化、友好的错误提示

### 1.3 核心安全机制

| 机制 | 作用 | 错误码 |
|------|------|--------|
| Read-before-Write | 强制先读取文件才能编辑 | 6 |
| 脏写检测 | 读取后文件被外部修改时拦截 | 7 |
| 引号规范化 | 处理 curly quotes 与 straight quotes 的匹配 | 8 |
| 多匹配检测 | 防止非唯一匹配导致的误替换 | 9 |

> **ys-code 现状：** 已对齐 Read-before-Write（`FileStateCache.canEdit`）、脏写检测（`validateInput` 和 `execute` 双层检测）、引号规范化（`findActualString` + `preserveQuoteStyle`）、多匹配检测（`matches > 1` 检查）。详见第四部分对比表。

---

## 2. 核心原理

### 2.1 执行时序

```
模型发起 Edit
    ↓
validateInput 第一层校验（错误码 6/7/8/9）
    ↓
UI 展示 proposed changes（diff 预览）
    ↓
用户按回车确认（或修改后确认）
    ↓
call 执行（第二层脏写检测 + 写入）
    ↓
更新 FileStateCache（编辑后视为"已全量读取"）
```

### 2.2 为什么必须用 Map 维护状态

**核心问题**：为什么不能只用一个 `Set<string>` 记录"读过哪些文件"？

**答案**：`readFileState` 不是"缓存"，是**读取凭证 + 状态快照**。

| 存储字段 | 作用 | 如果缺失 |
|---------|------|---------|
| `timestamp`（mtime） | 脏写检测基准 | 不知道"读取后文件是否被改过" |
| `content` | 内容回退对比 | Windows 云同步/杀毒软件改 mtime 不误报；编辑后可持续编辑 |
| `offset`/`limit` | 区分部分/全量读取 | 部分读取后 mtime 变了，不知该放行还是拦截 |
| `isPartialView` | 拒绝加工后的内容 | 模型看到 CLAUDE.md 截断版也允许编辑，危险 |

**场景对比**：

```
只存 Set<string>（仅记录"读过"）:
  Read 文件 A (offset=50, limit=20)  → Set.add("A")
  Vim 改文件 A                       → 不知道！
  Edit 文件 A                         → Set.has("A")=true → 放行 → 覆盖 Vim 修改

c 的 FileStateCache（记录"读过且长什么样"）:
  Read 文件 A (offset=50, limit=20)  → Cache[A]={mtime:1000, offset:50}
  Vim 改文件 A                       → mtime 变成 2000
  Edit 文件 A                         → mtime 2000 > 1000
                                     → 部分读取无法对比内容
                                     → 直接拦截（错误码 7）
```

> **ys-code 现状：** 已对齐。`FileStateCache` 使用 `LRUCache` 实现，存储 `content`、`timestamp`、`offset`、`limit`、`isPartialView` 五个字段。详见 `src/agent/file-state.ts`。

### 2.3 脏写检测的两次检查

```
T1: ReadTool 读取 → 记录 mtime=1000
    │
    ▼
T2: validateInput → 检查 mtime=1000（通过）
    │
    ▼
T3: 用户确认（可能持续数秒）
    │
    ├──→ 外部 Vim 修改文件 → mtime=2000（⚠️ 风险！）
    │
    ▼
T4: call 开始 → 再次检查 mtime=2000
    │           └── 发现 2000 > 1000
    │           └── 内容也变了
    │           └── 抛出 FILE_UNEXPECTEDLY_MODIFIED_ERROR
    │
    └──→ 如果没被修改 → 继续执行写入
```

**关键设计**：
- `validateInput` 中的脏写检测是**快照 A**
- `call` 开始时的脏写检测是**快照 B**
- 两次检测之间若文件被改，`call` 会再次发现
- 第二次检测用**同步读取**，避免异步操作被插入

> **ys-code 现状：** 已对齐。`validateInput` 中做一次脏写检测（`currentMtime > readCheck.record.timestamp`），`execute` 中做二次检测（`currentMtime > record.timestamp`）。详见 `src/agent/tools/edit.ts` 第 174-198 行和第 320-331 行。

---

## 3. 源码实现

### 3.1 工具定义

**源码路径**：`src/tools/FileEditTool/FileEditTool.ts`

```typescript
export const FileEditTool = buildTool({
  name: FILE_EDIT_TOOL_NAME,        // "Edit"
  searchHint: 'modify file contents in place',
  maxResultSizeChars: 100_000,
  strict: true,                     // 拒绝未知字段

  // Schema 定义（Zod）
  get inputSchema() { return inputSchema() },
  get outputSchema() { return outputSchema() },

  // 输入预处理
  backfillObservableInput(input) {
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)  // 规范化路径
    }
  },

  // 权限检查
  async checkPermissions(input, context) {
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      FileEditTool,
      input,
      appState.toolPermissionContext,
    )
  },

  // 校验与执行
  async validateInput(input, toolUseContext) { ... },
  async call(input, context, _, parentMessage) { ... },
})
```

**关键设计**：
- `strict: true`：输入拒绝未知字段，防止模型误传参数
- `expandPath`：统一处理 `~`、相对路径、Windows 路径分隔符
- `checkPermissions`：支持 alwaysAllow / alwaysDeny / alwaysAsk 三级权限规则

### 3.2 Prompt 设计

**源码路径**：`src/tools/FileEditTool/prompt.ts`

```typescript
function getPreReadInstruction(): string {
  return `
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.`
}
```

**核心设计**：cc 在 prompt 中**提前告知 AI**必须先 Read 才能 Edit：

```
"You must use your \`Read\` tool at least once in the conversation before editing.
This tool will error if you attempt an edit without reading the file."
```

这行描述的作用是：
1. **预防性提示**：让模型在调用 Edit 前就主动调用 Read
2. **错误码 6 的上下文**：当 validateInput 返回错误码 6 时，模型知道为什么
3. **用户体验**：减少"编辑被拒→重新读取→再次编辑"的往返次数

> **ys-code 现状：** 已对齐。`EditTool` 的 description 中包含相同的提示语。详见 `src/agent/tools/edit.ts` 第 148-156 行。

### 3.3 validateInput — 第一层校验

**源码路径**：`src/tools/FileEditTool/FileEditTool.ts`

`validateInput` 在模型提出编辑请求后、用户确认前执行。这是**第一道防线**。

#### 3.3.1 基础校验（步骤 1-4）

```typescript
const { file_path, old_string, new_string, replace_all = false } = input
const fullFilePath = expandPath(file_path)

// 1. 团队内存 secrets 检查
const secretError = checkTeamMemSecrets(fullFilePath, new_string)
if (secretError) return { result: false, message: secretError, errorCode: 0 }

// 2. 无变化检查
if (old_string === new_string) {
  return { result: false, behavior: 'ask', message: 'No changes...', errorCode: 1 }
}

// 3. 权限规则 deny 检查
const denyRule = matchingRuleForInput(fullFilePath, appState.toolPermissionContext, 'edit', 'deny')
if (denyRule !== null) {
  return { result: false, behavior: 'ask', message: 'File is denied...', errorCode: 2 }
}

// 4. UNC 路径安全跳过（防止 NTLM 凭证泄漏）
if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
  return { result: true }  // 跳过文件系统检查，由权限系统处理
}
```

#### 3.3.2 文件大小与存在性检查（步骤 5-9）

```typescript
// 5. 文件大小限制（1GB 防 OOM）
const { size } = await fs.stat(fullFilePath)
if (size > MAX_EDIT_FILE_SIZE) {
  return { result: false, behavior: 'ask', message: 'File too large...', errorCode: 10 }
}

// 6. 读取文件内容（带编码检测）
let fileContent: string | null
try {
  const fileBuffer = await fs.readFileBytes(fullFilePath)
  const encoding = (fileBuffer.length >= 2 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xfe)
    ? 'utf16le'
    : 'utf8'
  fileContent = fileBuffer.toString(encoding).replaceAll('\r\n', '\n')
} catch (e) {
  if (isENOENT(e)) fileContent = null
  else throw e
}

// 7. 文件不存在处理
if (fileContent === null) {
  if (old_string === '') return { result: true }  // 创建新文件
  // 尝试找相似文件建议
  const similarFilename = findSimilarFile(fullFilePath)
  return { result: false, behavior: 'ask', message: 'File does not exist...', errorCode: 4 }
}

// 8. 文件存在但 old_string 为空
if (old_string === '') {
  if (fileContent.trim() !== '') {
    return { result: false, behavior: 'ask', message: 'Cannot create...', errorCode: 3 }
  }
  return { result: true }  // 空文件替换为空内容
}

// 9. Jupyter Notebook 保护
if (fullFilePath.endsWith('.ipynb')) {
  return { result: false, behavior: 'ask', message: 'Use NotebookEditTool', errorCode: 5 }
}
```

#### 3.3.3 核心：read-before-write 检查（错误码 6，步骤 10）

```typescript
// 10. 检查文件是否已通过 ReadTool 读取
const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
if (!readTimestamp || readTimestamp.isPartialView) {
  return {
    result: false,
    behavior: 'ask',
    message: 'File has not been read yet. Read it first before writing to it.',
    errorCode: 6,
  }
}
```

**关键逻辑**：
- `toolUseContext.readFileState` 是 `FileStateCache`（LRUCache 封装）
- 只有 `FileReadTool` 成功读取后才会写入该缓存
- `isPartialView` 为 true 时也拒绝（模型看到的是加工后的内容，如 CLAUDE.md 截断版）

> **ys-code 现状：** 已对齐。`validateInput` 中调用 `context.fileStateCache.canEdit(fullPath)`，检查文件是否已读取、是否为部分视图。详见 `src/agent/tools/edit.ts` 第 163-172 行。

#### 3.3.4 核心：脏写检测第一层（错误码 7，步骤 11）

```typescript
// 11. 检查文件是否被外部修改
if (readTimestamp) {
  const lastWriteTime = getFileModificationTime(fullFilePath)
  if (lastWriteTime > readTimestamp.timestamp) {
    // mtime 变了！可能外部工具改过了
    const isFullRead =
      readTimestamp.offset === undefined &&
      readTimestamp.limit === undefined

    if (isFullRead && fileContent === readTimestamp.content) {
      // 内容没变，是误报（Windows 云同步、杀毒软件等只改 mtime）
      // 放行
    } else {
      return {
        result: false,
        behavior: 'ask',
        message: 'File has been modified since read...',
        errorCode: 7,
      }
    }
  }
}
```

**设计细节**：
- 先比 `mtime`（快），mtime 没变则安全
- mtime 变了再比 `content`（慢但准确）
- 只有**全量读取**才做内容回退对比（部分读取时 `readTimestamp.content` 不是完整文件）

> **ys-code 现状：** 已对齐。`validateInput` 中先比较 `currentMtime > readCheck.record.timestamp`，若 mtime 变化且为全量读取则对比内容，若内容不同则返回错误码 7。详见 `src/agent/tools/edit.ts` 第 175-198 行。

#### 3.3.5 字符串匹配检查（步骤 12-14）

```typescript
// 12. 引号规范化：处理 curly quotes vs straight quotes
const actualOldString = findActualString(file, old_string)
if (!actualOldString) {
  return { result: false, behavior: 'ask', message: 'String not found', errorCode: 8 }
}

// 13. 多匹配检测
const matches = file.split(actualOldString).length - 1
if (matches > 1 && !replace_all) {
  return { result: false, behavior: 'ask', message: 'Multiple matches', errorCode: 9 }
}

// 14. 设置文件特殊校验
const settingsValidationResult = validateInputForSettingsFileEdit(...)
if (settingsValidationResult !== null) return settingsValidationResult

return { result: true, meta: { actualOldString } }
```

> **ys-code 现状：** 已对齐引号规范化和多匹配检测。设置文件特殊校验未实现。

### 3.4 call（execute）— 执行阶段

**源码路径**：`src/tools/FileEditTool/FileEditTool.ts`

`call` 是真正修改文件的函数。cc 在这里做了**第二层脏写检测**。

#### 3.4.1 前置准备（步骤 1-4）

```typescript
async call(input, { readFileState, userModified, ... }, _, parentMessage) {
  const fs = getFsImplementation()
  const absoluteFilePath = expandPath(file_path)

  // 1. 技能目录发现（非阻塞，后台加载）
  const newSkillDirs = await discoverSkillDirsForPaths([absoluteFilePath], cwd)
  if (newSkillDirs.length > 0) {
    addSkillDirectories(newSkillDirs).catch(() => {})
  }

  // 2. LSP 诊断跟踪（编辑前记录）
  await diagnosticTracker.beforeFileEdited(absoluteFilePath)

  // 3. 确保父目录存在
  await fs.mkdir(dirname(absoluteFilePath))

  // 4. 文件历史备份（可恢复）
  if (fileHistoryEnabled()) {
    await fileHistoryTrackEdit(updateFileHistoryState, absoluteFilePath, parentMessage.uuid)
  }
```

#### 3.4.2 核心：二次脏写检测（步骤 5-6）

```typescript
  // 5. 重新读取文件（同步读取，保证原子性）
  const {
    content: originalFileContents,
    fileExists,
    encoding,
    lineEndings: endings,
  } = readFileForEdit(absoluteFilePath)

  // 6. 二次脏写检测（真正写入前的最后防线）
  if (fileExists) {
    const lastWriteTime = getFileModificationTime(absoluteFilePath)
    const lastRead = readFileState.get(absoluteFilePath)
    if (!lastRead || lastWriteTime > lastRead.timestamp) {
      const isFullRead = lastRead &&
        lastRead.offset === undefined &&
        lastRead.limit === undefined
      const contentUnchanged =
        isFullRead && originalFileContents === lastRead.content
      if (!contentUnchanged) {
        throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
      }
    }
  }
```

**为什么需要两次检测？**
- `validateInput` 到 `call` 之间有时间差
- 用户确认期间，Vim、IDE、linter 可能修改了文件
- 第二次检测用**同步读取**（`readFileSyncWithMetadata`），避免异步操作被插入

> **ys-code 现状：** 已对齐。`execute` 中重新读取文件后，再次比较 mtime 和内容。详见 `src/agent/tools/edit.ts` 第 320-331 行。

#### 3.4.3 引号处理与 Patch 生成（步骤 7-9）

```typescript
  // 7. 执行时再次引号规范化
  const actualOldString =
    findActualString(originalFileContents, old_string) || old_string

  // 8. 保留文件原有的引号风格（curly quotes）
  const actualNewString = preserveQuoteStyle(
    old_string, actualOldString, new_string
  )

  // 9. 生成结构化 patch
  const { patch, updatedFile } = getPatchForEdit({
    filePath: absoluteFilePath,
    fileContents: originalFileContents,
    oldString: actualOldString,
    newString: actualNewString,
    replaceAll: replace_all,
  })
```

> **ys-code 现状：** 已对齐。`execute` 中调用 `findActualString` 和 `preserveQuoteStyle`，使用 `generatePatch` 生成结构化 patch。详见 `src/agent/tools/edit.ts` 第 340-345 行和 `src/agent/tools/diff-formatter.ts`。

#### 3.4.4 写入与通知（步骤 10-12）

```typescript
  // 10. 原子写入（保持原有编码和行尾符）
  writeTextContent(absoluteFilePath, updatedFile, encoding, endings)

  // 11. 通知 LSP 服务器
  const lspManager = getLspServerManager()
  if (lspManager) {
    clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
    lspManager.changeFile(absoluteFilePath, updatedFile).catch(...)
    lspManager.saveFile(absoluteFilePath).catch(...)
  }

  // 12. 通知 VSCode diff 视图
  notifyVscodeFileUpdated(absoluteFilePath, originalFileContents, updatedFile)
```

> **ys-code 现状：** 已对齐原子写入和编码/行尾保持。LSP 通知和 VSCode 通知未实现。

#### 3.4.5 核心：更新 readFileState（步骤 13）

```typescript
  // 13. 更新读取状态（编辑后视为"已全量读取"）
  readFileState.set(absoluteFilePath, {
    content: updatedFile,           // 新内容
    timestamp: getFileModificationTime(absoluteFilePath),  // 新 mtime
    offset: undefined,              // 清空部分读取标记
    limit: undefined,
  })
```

**关键设计**：
- 编辑成功后，`offset` 和 `limit` 被清空为 `undefined`
- 这意味着刚编辑完的文件**不需要重新 Read** 就能再次 Edit
- 因为 `content` 和 `timestamp` 都是最新的

> **ys-code 现状：** 已对齐。`recordEdit` 方法更新缓存，清空 `offset`/`limit`，设置 `isPartialView: false`。详见 `src/agent/file-state.ts` 第 90-98 行。

#### 3.4.6 日志与返回（步骤 14-16）

```typescript
  // 14. 分析日志
  countLinesChanged(patch)
  logFileOperation({ operation: 'edit', tool: 'FileEditTool', filePath: absoluteFilePath })

  // 15. 远程模式下的 git diff
  let gitDiff: ToolUseDiff | undefined
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    gitDiff = await fetchSingleFileGitDiff(absoluteFilePath)
  }

  // 16. 返回结果
  return {
    data: {
      filePath: file_path,
      oldString: actualOldString,
      newString: new_string,
      originalFile: originalFileContents,
      structuredPatch: patch,       // 结构化 diff，用于 UI 渲染
      userModified: userModified ?? false,
      replaceAll: replace_all,
      ...(gitDiff && { gitDiff }),
    }
  }
}
```

### 3.5 错误码体系

| 错误码 | 触发场景 | 消息示例 | ys-code 状态 |
|--------|---------|---------|-------------|
| 0 | 团队内存 secrets 检查失败 | "You are trying to add a secret..." | ❌ 未实现 |
| 1 | `old_string === new_string` | "No changes to make..." | ✅ 已对齐 |
| 2 | 权限规则 deny | "File is in a denied directory..." | ❌ 未实现（仅有基础权限检查） |
| 3 | 文件存在但 `old_string` 为空 | "Cannot create new file - file already exists" | ⚠️ 部分对齐（直接拒绝，不检查是否空文件） |
| 4 | 文件不存在且 `old_string` 非空 | "File does not exist..." | ✅ 已对齐（含相似文件建议） |
| 5 | Jupyter Notebook | "Use NotebookEditTool..." | ✅ 已对齐 |
| **6** | **文件未读取或部分视图** | **"File has not been read yet..."** | ✅ **已对齐** |
| **7** | **文件在读取后被外部修改** | **"File has been modified since read..."** | ✅ **已对齐** |
| 8 | `old_string` 找不到 | "String to replace not found..." | ✅ 已对齐 |
| 9 | 多匹配但 `replace_all=false` | "Found N matches..." | ✅ 已对齐 |
| 10 | 文件超过 1GB | "File is too large to edit..." | ✅ 已对齐 |
| 11 | JSON 编辑导致非法 JSON | "Edit would result in invalid JSON" | ✅ 已对齐（ys-code 扩展） |

**恢复路径**：
- 错误码 6：模型调用 `Read` 工具 → ReadTool 记录状态 → 再次 `Edit`
- 错误码 7：模型调用 `Read` 工具 → 获取最新内容 → 再次 `Edit`

### 3.6 FileStateCache 实现

**源码路径**：`src/utils/fileStateCache.ts`

```typescript
export type FileState = {
  content: string           // 读取时的文件内容
  timestamp: number         // fs.stat().mtimeMs
  offset: number | undefined
  limit: number | undefined
  isPartialView?: boolean   // 是否为"加工后"的视图
}

export class FileStateCache {
  private cache: LRUCache<string, FileState>

  constructor(maxEntries: number, maxSizeBytes: number) {
    this.cache = new LRUCache({
      max: maxEntries,                    // 默认 100 个文件
      maxSize: maxSizeBytes,              // 默认 25MB
      sizeCalculation: value => Math.max(1, Buffer.byteLength(value.content)),
    })
  }

  get(key: string): FileState | undefined {
    return this.cache.get(normalize(key))   // 路径规范化
  }

  set(key: string, value: FileState): this {
    this.cache.set(normalize(key), value)
    return this
  }
}
```

**设计要点**：
- 路径统一 `normalize`，解决 Windows `/` vs `\` 问题
- 按 `content` 字节数计算 size，大文件自动淘汰
- 支持 `dump()` / `load()` 用于会话持久化

> **ys-code 现状：** 已对齐。`FileStateCache` 使用 `lru-cache` 库，实现 `recordRead`、`canEdit`、`recordEdit`、`snapshot`、`clear` 方法。详见 `src/agent/file-state.ts`。

---

## 4. 与 ys-code 对比

### 4.1 功能对齐状态总览

| 功能模块 | cc | ys-code | 状态 |
|---------|-----|---------|------|
| **基础安全机制** |
| Read-before-Write | ✅ | ✅ | **已对齐** |
| 脏写检测（双层） | ✅ | ✅ | **已对齐** |
| 引号规范化 | ✅ | ✅ | **已对齐** |
| 多匹配检测 | ✅ | ✅ | **已对齐** |
| 文件大小限制 | ✅ | ✅ | **已对齐** |
| **文件处理** |
| 编码检测（utf8/utf16le） | ✅ | ✅ | **已对齐** |
| 行尾符保持（CRLF/LF） | ✅ | ✅ | **已对齐** |
| 相似文件建议 | ✅ | ✅ | **已对齐** |
| 新文件创建 | ✅ | ✅ | **已对齐** |
| Jupyter Notebook 保护 | ✅ | ✅ | **已对齐** |
| JSON 合法性校验 | ❌ | ✅ | **ys-code 扩展** |
| **框架能力** |
| 输入校验 (`validateInput`) | ✅ | ✅ | **已对齐** |
| 权限检查 (`checkPermissions`) | ✅ | ✅ | **已对齐（基础）** |
| 参数预处理 | ✅ | ✅ | **已对齐** |
| 严格模式 (`strict`) | ✅ | ❌ | 未实现 |
| 结果大小限制 | ✅ | ❌ | 未实现 |
| **UI 与集成** |
| 结构化 Patch 生成 | ✅ | ✅ | **已对齐** |
| UI 渲染层（React/JSX） | ✅ | ❌ | 未实现 |
| LSP 通知（didChange/didSave） | ✅ | ❌ | 未实现 |
| VSCode 通知 | ✅ | ❌ | 未实现 |
| 文件历史备份 | ✅ | ❌ | 未实现 |
| Git diff 获取 | ✅ | ❌ | 未实现 |
| **高级功能** |
| 团队 secrets 检查 | ✅ | ❌ | 未实现 |
| 权限规则系统（allow/deny/ask） | ✅ | ❌ | 未实现 |
| 设置文件特殊校验 | ✅ | ❌ | 未实现 |
| 技能目录发现 | ✅ | ❌ | 未实现 |
| 诊断跟踪 | ✅ | ❌ | 未实现 |

### 4.2 代码量对比（更新后）

| 文件 | cc 行数 | ys-code 行数 | 说明 |
|------|---------|-------------|------|
| 主工具文件 | ~625 (`FileEditTool.ts`) | ~385 (`edit.ts`) | ys-code 已大幅增长 |
| FileStateCache | ~35 (`fileStateCache.ts`) | ~118 (`file-state.ts`) | ys-code 更完整 |
| 文件编码处理 | ~120 (`fileIO.ts`) | ~87 (`file-encoding.ts`) | 基本对齐 |
| Diff 生成 | ~200 (`utils.ts`) | ~95 (`diff-formatter.ts`) | ys-code 更精简 |
| 文件大小保护 | ~50 (`fileGuard.ts`) | ~47 (`file-guard.ts`) | 基本对齐 |
| **合计** | **~1030 行** | **~732 行** | ys-code 已达 cc 的 71% |

---

## 5. 可借鉴点与建议

### 5.1 P0（高优先级，建议尽快引入）

#### 1. 严格模式（`strict: true`）

**问题**：ys-code 使用 `Type.Object`，允许额外字段通过，模型可能误传参数。

**cc 做法**：`z.strictObject` 拒绝未知字段。

**建议**：在 `defineAgentTool` 中增加 `strict` 选项，使用 `Type.Object({ ... }, { additionalProperties: false })` 实现。

> **建议：** [P0] 在 `defineAgentTool` 中支持 `strict` 模式，拒绝未知字段。

#### 2. 设置文件特殊校验

**问题**：编辑 `.vscode/settings.json`、`.gitignore` 等配置文件时，格式错误可能导致工具失效。

**cc 做法**：`validateInputForSettingsFileEdit` 对特定文件类型做额外校验。

**建议**：为 JSON、YAML、INI 等配置文件增加格式校验，确保编辑后仍是合法配置。

> **建议：** [P0] 增加设置文件编辑校验，防止配置文件格式错误。

### 5.2 P1（中优先级，后续逐步引入）

#### 3. LSP 集成

**问题**：编辑 TypeScript 文件后，类型检查器不知道文件已变更，导致诊断信息滞后。

**cc 做法**：编辑后发送 `didChange` + `didSave` 通知 LSP 服务器。

**建议**：接入 `vscode-languageserver-types` 和 `vscode-jsonrpc`，实现 LSP 通知。

> **建议：** [P1] 接入 LSP 通知，编辑后触发类型检查和诊断更新。

#### 4. 文件历史备份

**问题**：编辑错误后无法恢复，用户可能丢失重要代码。

**cc 做法**：`fileHistoryTrackEdit` 在编辑前备份原始内容。

**建议**：在 `execute` 中增加文件历史备份机制，支持后续恢复。

> **建议：** [P1] 增加文件历史备份，支持编辑恢复。

#### 5. 团队 Secrets 检查

**问题**：模型可能不小心将密钥、token 写入代码文件。

**cc 做法**：`checkTeamMemSecrets` 检查新字符串是否包含敏感信息。

**建议**：增加简单的 secrets 检测（正则匹配 API key、password 等模式）。

> **建议：** [P1] 增加 secrets 检查，防止敏感信息泄露。

### 5.3 P2（低优先级，根据需求决定）

#### 6. UI 渲染层

**cc 做法**：完整的 React/JSX UI，支持 diff 预览、verbose/condensed 模式。

**建议**：Ink 界面成熟后，再引入结构化 diff 渲染。

> **建议：** [P2] Ink TUI 中增加 diff 预览和文件操作可视化。

#### 7. 权限规则系统

**cc 做法**：支持 alwaysAllow / alwaysDeny / alwaysAsk 三级规则，基于路径模式匹配。

**建议**：当前基础权限检查已够用，复杂规则后续按需引入。

> **建议：** [P2] 按需引入基于路径模式的权限规则系统。

#### 8. 技能目录发现

**cc 做法**：`discoverSkillDirsForPaths` 自动发现并加载技能目录。

**建议**：与项目的 skill 系统集成时引入。

> **建议：** [P2] 与 skill 系统集成时引入自动发现机制。

#### 9. Git diff 获取

**cc 做法**：远程模式下获取单文件的 git diff 信息。

**建议**：与 git 工作流集成时引入。

> **建议：** [P2] 与 git 工作流集成时引入远程 diff 获取。

---

## 6. 参考链接

### 6.1 cc 源码路径

| 文件 | 路径 | 说明 |
|------|------|------|
| 主工具定义 | `src/tools/FileEditTool/FileEditTool.ts` | buildTool 注册、validateInput、call |
| 类型定义 | `src/tools/FileEditTool/types.ts` | Input/Output Schema、Zod 定义 |
| 工具函数 | `src/tools/FileEditTool/utils.ts` | findActualString、preserveQuoteStyle、getPatchForEdit |
| UI 渲染 | `src/tools/FileEditTool/UI.tsx` | React/JSX 组件、userFacingName、renderToolResultMessage |
| Prompt | `src/tools/FileEditTool/prompt.ts` | getEditToolDescription、getPreReadInstruction |
| 常量 | `src/tools/FileEditTool/constants.ts` | FILE_EDIT_TOOL_NAME、MAX_EDIT_FILE_SIZE |
| FileStateCache | `src/utils/fileStateCache.ts` | LRUCache 封装、dump/load |
| 文件 IO | `src/utils/fileIO.ts` | readFileForEdit、writeTextContent、编码检测 |

### 6.2 ys-code 源码路径

| 文件 | 路径 | 说明 |
|------|------|------|
| EditTool | `src/agent/tools/edit.ts` | defineAgentTool 注册、validateInput、execute |
| FileStateCache | `src/agent/file-state.ts` | LRUCache 封装、recordRead/canEdit/recordEdit |
| 文件编码 | `src/agent/tools/file-encoding.ts` | readFileWithEncoding、writeFileWithEncoding |
| Diff 生成 | `src/agent/tools/diff-formatter.ts` | generatePatch、formatPatchToText |
| 文件保护 | `src/agent/tools/file-guard.ts` | checkFileSize、DIRTY_WRITE_MESSAGE |

---

*文档完成。此分析基于 cc 的源码实现，结合 ys-code 的当前状态，提供设计参考和迁移建议。*
