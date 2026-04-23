# cc EditTool 源码分析

> 分析对象：claude-code-haha（cc）的 `FileEditTool`
> 分析日期：2026-04-23
> 组织方式：时序流（按一次完整调用的执行时间线展开）
> 目标：理解 cc 的文件编辑安全机制与执行链路，不涉及迁移方案

---

## 第一章：入口与工具定义

### 1.1 buildTool 注册

```typescript
// src/tools/FileEditTool/FileEditTool.ts

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

### 1.2 给 AI 的描述（prompt）

```typescript
// src/tools/FileEditTool/FileEditTool.ts

async description() {
  return 'A tool for editing files'   // 简短描述
},
async prompt() {
  return getEditToolDescription()      // 详细使用说明（传给 AI）
},
```

```typescript
// src/tools/FileEditTool/prompt.ts

function getPreReadInstruction(): string {
  return `
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.`
}

function getDefaultEditDescription(): string {
  return `Performs exact string replacements in files.

Usage:${getPreReadInstruction()}
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix...
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it...
- The edit will FAIL if \`old_string\` is not unique in the file...
- Use \`replace_all\` for replacing and renaming strings across the file.`
}
```

**核心设计**：cc 在 prompt 中**提前告知 AI**必须先 Read 才能 Edit：

```
"You must use your `Read` tool at least once in the conversation before editing.
This tool will error if you attempt an edit without reading the file."
```

这行描述的作用是：
1. **预防性提示**：让模型在调用 Edit 前就主动调用 Read
2. **错误码 6 的上下文**：当 validateInput 返回错误码 6 时，模型知道为什么
3. **用户体验**：减少"编辑被拒→重新读取→再次编辑"的往返次数

### 1.3 动态函数

cc 的 EditTool 还注册了多个**根据输入动态返回**的函数，用于 UI 展示：

```typescript
// src/tools/FileEditTool/UI.tsx

// 根据输入返回用户可见的操作名称
export function userFacingName(input): string {
  if (!input) return 'Update'
  if (input.file_path?.startsWith(getPlansDirectory())) return 'Updated plan'
  if (input.edits != null) return 'Update'       // 批量编辑
  if (input.old_string === '') return 'Create'    // 空 old_string = 创建文件
  return 'Update'
}

// 返回工具使用的摘要（文件路径）
export function getToolUseSummary(input): string | null {
  if (!input?.file_path) return null
  return getDisplayPath(input.file_path)          // 展示路径（如 ~/project/src/foo.ts）
}

// 活动描述（状态栏/进度显示）
getActivityDescription(input) {
  const summary = getToolUseSummary(input)
  return summary ? `Editing ${summary}` : 'Editing file'
}
```

**动态返回对照表**：

| 输入条件 | `userFacingName` | `getActivityDescription` |
|---------|------------------|-------------------------|
| `old_string === ''` | Create | Editing src/foo.ts |
| 文件在 plans 目录 | Updated plan | Editing plan.md |
| 其他情况 | Update | Editing src/foo.ts |

---

### 1.4 为什么必须用 Map 维护状态

**核心问题**：为什么要存 `content`、`timestamp`、`offset`、`limit`？不能只用一个 `Set<string>` 记录"读过哪些文件"吗？

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

cc 的 FileStateCache（记录"读过且长什么样"）:
  Read 文件 A (offset=50, limit=20)  → Cache[A]={mtime:1000, offset:50}
  Vim 改文件 A                       → mtime 变成 2000
  Edit 文件 A                         → mtime 2000 > 1000
                                     → 部分读取无法对比内容
                                     → 直接拦截（错误码 7）
```

---

## 第二章：validateInput — 第一层校验

`validateInput` 在模型提出编辑请求后、用户确认前执行。这是**第一道防线**。

### 2.1 基础校验

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

### 2.2 文件大小与存在性检查

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

### 2.3 核心：read-before-write 检查（错误码 6）

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

### 2.4 核心：脏写检测第一层（错误码 7）

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

### 2.5 字符串匹配检查

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

---

## 第三章：用户确认到 call 的间隙

`validateInput` 返回 `{ result: true }` 后，并不立即执行编辑。cc 的交互流程：

```
模型发起 Edit
    ↓
validateInput 通过
    ↓
UI 展示 proposed changes（diff 预览）
    ↓
用户按回车确认（或修改后确认）
    ↓
call（execute）执行
```

**关键风险**：用户确认的这几秒钟内，文件可能被外部修改。

cc 的应对：
1. `validateInput` 中的脏写检测是**快照 A**
2. `call` 开始时的脏写检测是**快照 B**
3. 两次检测之间若文件被改，`call` 会再次发现

---

## 第四章：call（execute）— 执行阶段

`call` 是真正修改文件的函数。cc 在这里做了**第二层脏写检测**。

### 4.1 前置准备

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

### 4.2 核心：二次脏写检测

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

### 4.3 引号处理与 Patch 生成

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

### 4.4 写入与通知

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

### 4.5 核心：更新 readFileState

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

### 4.6 日志与返回

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

---

## 第五章：错误码体系

| 错误码 | 触发场景 | 消息示例 |
|--------|---------|---------|
| 0 | 团队内存 secrets 检查失败 | "You are trying to add a secret..." |
| 1 | `old_string === new_string` | "No changes to make..." |
| 2 | 权限规则 deny | "File is in a denied directory..." |
| 3 | 文件存在但 `old_string` 为空 | "Cannot create new file - file already exists" |
| 4 | 文件不存在且 `old_string` 非空 | "File does not exist..." |
| 5 | Jupyter Notebook | "Use NotebookEditTool..." |
| **6** | **文件未读取或部分视图** | **"File has not been read yet..."** |
| **7** | **文件在读取后被外部修改** | **"File has been modified since read..."** |
| 8 | `old_string` 找不到 | "String to replace not found..." |
| 9 | 多匹配但 `replace_all=false` | "Found N matches..." |
| 10 | 文件超过 1GB | "File is too large to edit..." |

**恢复路径**：
- 错误码 6：模型调用 `Read` 工具 → ReadTool 记录状态 → 再次 `Edit`
- 错误码 7：模型调用 `Read` 工具 → 获取最新内容 → 再次 `Edit`

---

## 第六章：数据流图

### 6.1 完整时序

```
┌──────────────┐     读取文件      ┌─────────────────┐
│   ReadTool   │ ────────────────→ │  FileStateCache │
│  (读取成功)   │  {content,mtime} │  (LRU, 25MB)    │
└──────────────┘                   └────────┬────────┘
                                            │
                                            ▼ get()
┌──────────────┐     validateInput    ┌──────────────┐
│   EditTool   │ ←─────────────────── │  第一层检查   │
│  (模型请求)   │   错误码 6/7/8/9    │  mtime+内容   │
└──────────────┘                      └──────────────┘
                                            │
                                            ▼ result: true
                                     ┌──────────────┐
                                     │  用户确认界面  │
                                     │ (展示 diff)   │
                                     └──────────────┘
                                            │
                                            ▼ 用户按回车
                                     ┌──────────────┐
                                     │  call 执行    │
                                     │ 第二层 mtime  │
                                     │  检查 + 写入  │
                                     └──────────────┘
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │ 更新 Cache   │
                                     │ {新内容,新mtime}
                                     │ offset/limit  │
                                     │ 清空为 undefined│
                                     └──────────────┘
```

### 6.2 脏写检测的两次检查

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

---

## 附录：FileStateCache 实现

```typescript
// src/utils/fileStateCache.ts

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

---

*文档完成。此分析仅用于理解 cc 的实现逻辑，不涉及迁移方案。*
