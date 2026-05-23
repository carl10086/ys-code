# EditTool 实现对比分析

> **对比对象**：claude-code-haha（以下简称 "cc"）的 `FileEditTool` vs 当前项目（ys-code）的 `EditTool`
> **分析日期**：2026-04-23
> **文档版本**：v2（统一分析框架）
> **目标**：全面对比两个项目的 EditTool 实现，识别差异、评估对齐状态、给出优先级建议

---

## 1. 背景与定位

### 1.1 对比对象

| 项目 | 定位 | 技术栈 |
|------|------|--------|
| **cc (claude-code-haha)** | Anthropic 官方 Claude Code CLI 的参考实现 | Bun + TypeScript + Zod + React/JSX |
| **ys-code** | 分阶段逼近 Claude Code 的可控实现项目 | Bun + TypeScript + TypeBox + Ink |

### 1.2 分析范围

本次对比覆盖以下维度：
- 工具框架与架构设计
- 输入输出 Schema 定义
- 校验逻辑（validateInput）
- 执行逻辑（call / execute）
- UI 渲染与用户体验
- 安全机制与错误处理
- 代码量与复杂度

### 1.3 核心结论（前置）

**ys-code 已实现 cc EditTool 约 71% 的核心功能**，基础安全机制（Read-before-Write、脏写检测、引号规范化）已完全对齐。主要差距集中在 UI 渲染层、LSP 集成、权限规则系统等高级功能。

> **ys-code 现状：** 基础安全机制已对齐，代码量从 ~155 行增长至 ~732 行，达到 cc 的 71%。

---

## 2. 核心原理

### 2.1 架构对比

```
cc 的 EditTool 架构:
┌─────────────────────────────────────────┐
│  buildTool({ ... })                     │
│  ├── strict: true                       │
│  ├── inputSchema (Zod)                  │
│  ├── outputSchema (Zod)                 │
│  ├── backfillObservableInput            │
│  ├── checkPermissions                   │
│  ├── validateInput                      │
│  ├── call                               │
│  ├── renderToolUseMessage               │
│  ├── renderToolResultMessage            │
│  └── renderToolUseRejectedMessage       │
└─────────────────────────────────────────┘

ys-code 的 EditTool 架构:
┌─────────────────────────────────────────┐
│  defineAgentTool({ ... })               │
│  ├── parameters (TypeBox)               │
│  ├── outputSchema (TypeBox)             │
│  ├── validateInput                      │
│  ├── execute                            │
│  ├── formatResult                       │
│  └── renderResult                       │
└─────────────────────────────────────────┘
```

**关键差异**：
- cc 使用集中式 `buildTool` 工厂，支持 20+ 个配置项
- ys-code 使用轻量级 `defineAgentTool`，聚焦核心功能
- cc 的 UI 渲染与工具定义耦合，ys-code 分离了 `formatResult` 和 `renderResult`

### 2.2 数据流对比

```
cc 的数据流:
ReadTool → FileStateCache → validateInput → UI 预览 → 用户确认 → call → LSP 通知 → VSCode 通知 → 更新 Cache

ys-code 的数据流:
ReadTool → FileStateCache → validateInput → execute → 更新 Cache → formatResult/renderResult
```

**关键差异**：
- cc 有"用户确认"环节（UI 预览 + 回车确认），ys-code 直接执行
- cc 编辑后通知 LSP 和 VSCode，ys-code 无 IDE 集成
- 两者都维护 FileStateCache，实现 Read-before-Write 和脏写检测

---

## 3. 源码实现

### 3.1 工具框架对比

#### 3.1.1 定义方式

| 维度 | cc | ys-code |
|------|-----|---------|
| **Schema 库** | Zod (`zod/v4`) | TypeBox (`@sinclair/typebox`) |
| **构建函数** | `buildTool({ ... })` — 集中式工具工厂 | `defineAgentTool({ ... })` — 简单对象合并 |
| **类型定义** | `ToolDef<Input, Output>` + `BuiltTool<D>` | `AgentTool<TParameters, TOutput>` 接口 |
| **默认值机制** | `TOOL_DEFAULTS` 提供 fail-closed 默认值 | `defineAgentTool` 中用展开运算符提供基础默认值 |

**cc 的 buildTool**：

```typescript
// src/tools/FileEditTool/FileEditTool.ts
export const FileEditTool = buildTool({
  name: FILE_EDIT_TOOL_NAME,
  searchHint: 'modify file contents in place',
  maxResultSizeChars: 100_000,
  strict: true,
  
  // Schema
  get inputSchema() { return inputSchema() },
  get outputSchema() { return outputSchema() },
  
  // 输入处理
  backfillObservableInput(input) {
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },
  
  // 权限
  async checkPermissions(input, context) { ... },
  
  // 校验与执行
  async validateInput(input, toolUseContext) { ... },
  async call(input, context, _, parentMessage) { ... },
  
  // UI 渲染
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
})
```

**ys-code 的 defineAgentTool**：

```typescript
// src/agent/tools/edit.ts
export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    name: "Edit",
    label: "Edit",
    description: `Performs exact string replacements in files...`,
    parameters: editSchema,
    outputSchema: editOutputSchema,
    isDestructive: true,
    
    validateInput: async (params, context) => { ... },
    async execute(toolCallId, params, context) { ... },
    
    formatResult(output, toolCallId) { ... },
    renderResult(output, toolCallId) { ... },
  });
}
```

#### 3.1.2 框架能力矩阵

| 能力 | cc | ys-code | 状态 |
|------|-----|---------|------|
| 输入校验 (`validateInput`) | ✅ | ✅ | **已对齐** |
| 权限检查 (`checkPermissions`) | ✅ | ✅ | **已对齐（基础）** |
| 参数预处理 (`backfillObservableInput`) | ✅ | ✅ (`prepareArguments`) | **已对齐** |
| 输入等价比较 (`inputsEquivalent`) | ✅ | ❌ | 未实现 |
| 并发安全标记 (`isConcurrencySafe`) | ✅ | ✅ | **已对齐** |
| 只读标记 (`isReadOnly`) | ✅ | ✅ | **已对齐** |
| 破坏性标记 (`isDestructive`) | ✅ | ✅ | **已对齐** |
| UI 渲染 (`renderToolResultMessage` 等) | ✅ 完整 React/JSX | ❌ 仅文本返回 | 未实现 |
| 进度消息 (`renderToolUseProgressMessage`) | ✅ | ❌ | 未实现 |
| 拒绝消息渲染 (`renderToolUseRejectedMessage`) | ✅ | ❌ | 未实现 |
| 错误消息渲染 (`renderToolUseErrorMessage`) | ✅ | ❌ | 未实现 |
| 工具使用摘要 (`getToolUseSummary`) | ✅ | ❌ | 未实现 |
| 活动描述 (`getActivityDescription`) | ✅ | ❌ | 未实现 |
| 分类器输入 (`toAutoClassifierInput`) | ✅ | ❌ | 未实现 |
| 权限匹配器 (`preparePermissionMatcher`) | ✅ | ❌ | 未实现 |
| 路径提取 (`getPath`) | ✅ | ❌ | 未实现 |
| 严格模式 (`strict`) | ✅ | ❌ | 未实现 |
| 结果大小限制 (`maxResultSizeChars`) | ✅ | ❌ | 未实现 |
| 别名 (`aliases`) | ✅ | ❌ | 未实现 |
| 搜索提示 (`searchHint`) | ✅ | ❌ | 未实现 |
| MCP/LSP 标记 | ✅ | ❌ | 未实现 |
| 延迟加载 (`shouldDefer`) | ✅ | ❌ | 未实现 |

### 3.2 输入输出 Schema 对比

#### 3.2.1 输入参数

**cc (`FileEditInput`)**：

```typescript
{
  file_path: string,      // 绝对路径
  old_string: string,     // 要替换的文本
  new_string: string,     // 替换后的文本（必须不同于 old_string）
  replace_all: boolean    // 是否替换所有匹配（默认 false）
}
```

**ys-code (`EditInput`)**：

```typescript
{
  file_path: string,      // 文件路径（相对于 cwd 解析）
  old_string: string,     // 要替换的文本
  new_string: string,     // 替换后的文本
  replace_all?: boolean   // 是否替换所有匹配（可选）
}
```

**差异**：
- cc 使用 `z.strictObject`，拒绝未知字段；ys-code 使用 `Type.Object`，允许额外字段
- cc 的 `replace_all` 通过 `semanticBoolean` 预处理，支持语义化布尔值；ys-code 直接使用布尔值
- cc 的路径在 `backfillObservableInput` 中通过 `expandPath` 展开为绝对路径；ys-code 在 `validateInput` 中解析

> **建议：** [P0] 在 `defineAgentTool` 中支持 `strict` 模式，拒绝未知字段。

#### 3.2.2 输出参数

**cc (`FileEditOutput`)**：

```typescript
{
  filePath: string,
  oldString: string,
  newString: string,
  originalFile: string,      // 编辑前的完整文件内容
  structuredPatch: Hunk[],   // 结构化 diff patch
  userModified: boolean,     // 用户是否修改了建议的变更
  replaceAll: boolean,
  gitDiff?: GitDiff          // 可选的 Git diff 信息
}
```

**ys-code (`EditOutput`)**：

```typescript
{
  filePath: string,
  oldString: string,
  newString: string,
  originalFile: string,
  replaceAll: boolean,
  structuredPatch: StructuredPatchHunk[]  // 结构化 diff patch
}
```

**差异**：
- cc 包含 `userModified`（支持用户在权限提示中修改变更）
- cc 包含 `gitDiff`（远程模式下的 Git diff 信息）
- ys-code 已包含 `structuredPatch`（与 cc 对齐）

> **ys-code 现状：** `structuredPatch` 已对齐。`userModified` 和 `gitDiff` 未实现。

### 3.3 校验逻辑对比

#### 3.3.1 validateInput 步骤对比

| 校验项 | cc | ys-code | 状态 |
|--------|-----|---------|------|
| `old_string === new_string` | ✅ 返回错误码 1 | ✅ 返回错误码 1 | **已对齐** |
| 团队内存文件 secrets 检查 | ✅ `checkTeamMemSecrets` | ❌ 无 | 未实现 |
| 权限规则检查（deny） | ✅ `matchingRuleForInput` | ❌ 无 | 未实现 |
| UNC 路径安全检查 | ✅ 跳过文件系统操作 | ❌ 无 | 未实现 |
| 文件大小限制（1GB） | ✅ 防止 OOM | ✅ `checkFileSize` | **已对齐** |
| 文件不存在 + `old_string === ""` | ✅ 允许创建 | ✅ 允许创建 | **已对齐** |
| 文件存在 + `old_string === ""` | ✅ 仅当文件为空时允许 | ⚠️ 直接拒绝 | 部分对齐 |
| 文件不存在 + `old_string !== ""` | ✅ 提示相似文件建议 | ✅ 提示相似文件建议 | **已对齐** |
| Jupyter Notebook 保护 | ✅ 拒绝，提示使用 `NotebookEditTool` | ✅ 拒绝 | **已对齐** |
| **必须先读取文件** | ✅ **强制要求** | ✅ **强制要求** | **已对齐** |
| 文件修改时间戳检查 | ✅ 防止脏写 | ✅ 双层检测 | **已对齐** |
| 字符串匹配检查 | ✅ `findActualString`（支持引号规范化） | ✅ `findActualString` | **已对齐** |
| 多匹配检测 | ✅ 支持 `replace_all` | ✅ 支持 `replace_all` | **已对齐** |
| 设置文件编辑验证 | ✅ `validateInputForSettingsFileEdit` | ❌ 无 | 未实现 |
| JSON 合法性校验 | ❌ 无 | ✅ `JSON.parse` 预览 | **ys-code 扩展** |

#### 3.3.2 关键差异详解

**1. 文件存在但 `old_string === ""` 的处理**

cc 的做法：
```typescript
if (old_string === '') {
  if (fileContent.trim() !== '') {
    return { result: false, behavior: 'ask', message: 'Cannot create...', errorCode: 3 }
  }
  return { result: true }  // 空文件替换为空内容
}
```

ys-code 的做法：
```typescript
if (params.old_string === '') {
  return {
    ok: false,
    message: "Cannot create new file - file already exists.",
    errorCode: 3,
  };
}
```

**差异**：cc 允许编辑空文件（`old_string === ''` 且文件内容为空），ys-code 直接拒绝。

> **建议：** [P1] 允许编辑空文件，与 cc 行为一致。

**2. 引号规范化**

cc 的做法：
```typescript
function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) return searchString
  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  return null
}
```

ys-code 的做法：
```typescript
function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) return searchString
  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  return null
}
```

**状态**：已完全对齐。

> **ys-code 现状：** 引号规范化已完全对齐。

### 3.4 执行逻辑对比

#### 3.4.1 执行步骤对比

| 执行步骤 | cc | ys-code | 状态 |
|---------|-----|---------|------|
| 技能目录发现 | ✅ `discoverSkillDirsForPaths` | ❌ 无 | 未实现 |
| 诊断跟踪（LSP） | ✅ `diagnosticTracker.beforeFileEdited` | ❌ 无 | 未实现 |
| 父目录创建 | ✅ `fs.mkdir(dirname)` | ❌ 无 | 未实现 |
| 文件历史备份 | ✅ `fileHistoryTrackEdit` | ❌ 无 | 未实现 |
| 原子性保证 | ✅ 强调避免异步操作穿插 | ⚠️ 简单读写 | 部分对齐 |
| 文件编码处理 | ✅ 检测 utf16le / utf8 | ✅ `readFileWithEncoding` | **已对齐** |
| 行尾符处理 | ✅ CRLF → LF | ✅ `detectLineEndings` | **已对齐** |
| 引号规范化 | ✅ `findActualString` + `preserveQuoteStyle` | ✅ 已对齐 | **已对齐** |
| Patch 生成 | ✅ `getPatchForEdit` | ✅ `generatePatch` | **已对齐** |
| LSP 通知 | ✅ `didChange` + `didSave` | ❌ 无 | 未实现 |
| VSCode 通知 | ✅ `notifyVscodeFileUpdated` | ❌ 无 | 未实现 |
| 读取时间戳更新 | ✅ 更新 `readFileState` | ✅ `recordEdit` | **已对齐** |
| Git diff 获取 | ✅ 远程模式下可选 | ❌ 无 | 未实现 |
| 分析日志 | ✅ 多维度事件日志 | ❌ 无 | 未实现 |

#### 3.4.2 编码与行尾处理对比

**cc 的做法**：
```typescript
const fileBuffer = await fs.readFileBytes(fullFilePath)
const encoding = (fileBuffer.length >= 2 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xfe)
  ? 'utf16le'
  : 'utf8'
fileContent = fileBuffer.toString(encoding).replaceAll('\r\n', '\n')
```

**ys-code 的做法**：
```typescript
export async function readFileWithEncoding(path: string): Promise<ReadResult> {
  const buffer = await readFile(path);
  const encoding = detectEncoding(buffer);  // 检测 BOM
  let content = buffer.toString(encoding);
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);  // Strip BOM
  }
  const lineEndings = detectLineEndings(content);
  content = content.replaceAll("\r\n", "\n");
  return { content, encoding: { encoding, lineEndings } };
}
```

**状态**：已完全对齐，ys-code 的 `file-encoding.ts` 更模块化。

> **ys-code 现状：** 编码检测和行尾保持已完全对齐。

### 3.5 UI 渲染对比

#### 3.5.1 cc 的 UI 渲染

**源码路径**：`src/tools/FileEditTool/UI.tsx`

```typescript
// 根据输入返回用户可见的操作名称
export function userFacingName(input): string {
  if (!input) return 'Update'
  if (input.file_path?.startsWith(getPlansDirectory())) return 'Updated plan'
  if (input.edits != null) return 'Update'
  if (input.old_string === '') return 'Create'
  return 'Update'
}

// 返回工具使用的摘要（文件路径）
export function getToolUseSummary(input): string | null {
  if (!input?.file_path) return null
  return getDisplayPath(input.file_path)
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

#### 3.5.2 ys-code 的 UI 渲染

```typescript
formatResult(output, _toolCallId) {
  const baseMessage = output.replaceAll
    ? `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`
    : `The file ${output.filePath} has been updated successfully.`;
  const text = formatResultWithDiff(output.filePath, output.structuredPatch ?? [], baseMessage);
  return [{ type: "text" as const, text }];
},

renderResult(output, _toolCallId) {
  if (!output.structuredPatch || output.structuredPatch.length === 0) {
    return { type: "plain", text: "File updated (no diff available)" };
  }
  return {
    type: "structured_diff",
    filePath: output.filePath,
    hunks: output.structuredPatch,
  };
}
```

**差异**：
- cc 支持动态操作名称（Create / Update / Updated plan）
- cc 有完整的 React/JSX 渲染层，支持 diff 预览
- ys-code 仅返回文本或结构化 diff，无动态 UI

> **建议：** [P2] Ink TUI 中增加动态操作名称和 diff 预览。

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

> **ys-code 现状：** 代码量从 ~155 行增长至 ~732 行，核心安全机制已完全对齐。

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

#### 6. 空文件编辑支持

**问题**：cc 允许编辑空文件（`old_string === ''` 且文件内容为空），ys-code 直接拒绝。

**cc 做法**：
```typescript
if (old_string === '') {
  if (fileContent.trim() !== '') {
    return { result: false, behavior: 'ask', message: 'Cannot create...', errorCode: 3 }
  }
  return { result: true }  // 空文件替换为空内容
}
```

**建议**：允许编辑空文件，与 cc 行为一致。

> **建议：** [P1] 允许编辑空文件，与 cc 行为一致。

### 5.3 P2（低优先级，根据需求决定）

#### 7. UI 渲染层

**cc 做法**：完整的 React/JSX UI，支持 diff 预览、verbose/condensed 模式。

**建议**：Ink 界面成熟后，再引入结构化 diff 渲染。

> **建议：** [P2] Ink TUI 中增加 diff 预览和文件操作可视化。

#### 8. 权限规则系统

**cc 做法**：支持 alwaysAllow / alwaysDeny / alwaysAsk 三级规则，基于路径模式匹配。

**建议**：当前基础权限检查已够用，复杂规则后续按需引入。

> **建议：** [P2] 按需引入基于路径模式的权限规则系统。

#### 9. 技能目录发现

**cc 做法**：`discoverSkillDirsForPaths` 自动发现并加载技能目录。

**建议**：与项目的 skill 系统集成时引入。

> **建议：** [P2] 与 skill 系统集成时引入自动发现机制。

#### 10. Git diff 获取

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

### 6.3 历史文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 原始源码分析 | `docs/cc/2026-04-23-cc-EditTool-源码分析.md` | 第一版 cc 源码分析（时序流） |
| 原始对比分析 | `docs/cc/edit-tool-comparison.md` | 第一版对比分析（ys-code 仅 ~155 行） |

---

*文档完成。此对比分析基于 cc 和 ys-code 的当前源码，提供功能对齐状态评估和优先级建议。*
