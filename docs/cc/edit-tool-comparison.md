# EditTool 实现对比分析

> 对比对象：claude-code-haha（以下简称 "cc"）的 `FileEditTool` vs 当前项目（ys-code）的 `EditTool`
> 分析日期：2026-04-23

---

## 一、文件位置对比

| 项目 | 核心文件 | 辅助文件 |
|------|---------|---------|
| **cc (claude-code-haha)** | `src/tools/FileEditTool/FileEditTool.ts` | `types.ts`, `utils.ts`, `UI.tsx`, `prompt.ts`, `constants.ts` |
| **ys-code (当前项目)** | `src/agent/tools/edit.ts` | `src/agent/types.ts` (通用工具类型), `src/agent/define-agent-tool.ts`, `src/agent/tool-execution.ts` |

---

## 二、工具框架对比

### 2.1 定义方式

| 维度 | cc | ys-code |
|------|-----|---------|
| **Schema 库** | Zod (`zod/v4`) | TypeBox (`@sinclair/typebox`) |
| **构建函数** | `buildTool({ ... })` — 集中式工具工厂 | `defineAgentTool({ ... })` — 简单对象合并 |
| **类型定义** | `ToolDef<Input, Output>` + `BuiltTool<D>` | `AgentTool<TParameters, TOutput>` 接口 |
| **默认值机制** | `TOOL_DEFAULTS` 提供 fail-closed 默认值（`isEnabled`, `isConcurrencySafe`, `isReadOnly` 等） | `defineAgentTool` 中用展开运算符提供基础默认值 |

### 2.2 框架能力矩阵

| 能力 | cc | ys-code |
|------|-----|---------|
| 输入校验 (`validateInput`) | ✅ 支持 | ✅ 支持 |
| 权限检查 (`checkPermissions`) | ✅ 支持 | ✅ 支持 |
| 参数预处理 (`backfillObservableInput`) | ✅ 支持 | ✅ (`prepareArguments`) |
| 输入等价比较 (`inputsEquivalent`) | ✅ 支持 | ❌ 未实现 |
| 并发安全标记 (`isConcurrencySafe`) | ✅ 支持 | ✅ 支持 |
| 只读标记 (`isReadOnly`) | ✅ 支持 | ✅ 支持 |
| 破坏性标记 (`isDestructive`) | ✅ 支持 | ✅ 支持 |
| UI 渲染 (`renderToolResultMessage` 等) | ✅ 完整 React/JSX | ❌ 仅文本返回 (`formatResult`) |
| 进度消息 (`renderToolUseProgressMessage`) | ✅ 支持 | ❌ 未实现 |
| 拒绝消息渲染 (`renderToolUseRejectedMessage`) | ✅ 支持 | ❌ 未实现 |
| 错误消息渲染 (`renderToolUseErrorMessage`) | ✅ 支持 | ❌ 未实现 |
| 工具使用摘要 (`getToolUseSummary`) | ✅ 支持 | ❌ 未实现 |
| 活动描述 (`getActivityDescription`) | ✅ 支持 | ❌ 未实现 |
| 分类器输入 (`toAutoClassifierInput`) | ✅ 支持 | ❌ 未实现 |
| 权限匹配器 (`preparePermissionMatcher`) | ✅ 支持 | ❌ 未实现 |
| 路径提取 (`getPath`) | ✅ 支持 | ❌ 未实现 |
| 严格模式 (`strict`) | ✅ 支持 | ❌ 未实现 |
| 结果大小限制 (`maxResultSizeChars`) | ✅ 支持 | ❌ 未实现 |
| 别名 (`aliases`) | ✅ 支持 | ❌ 未实现 |
| 搜索提示 (`searchHint`) | ✅ 支持 | ❌ 未实现 |
| MCP/LSP 标记 | ✅ 支持 | ❌ 未实现 |
| 延迟加载 (`shouldDefer`) | ✅ 支持 | ❌ 未实现 |

---

## 三、EditTool 具体实现对比

### 3.1 输入参数 Schema

**cc (`FileEditInput`):**
```typescript
{
  file_path: string,      // 绝对路径
  old_string: string,     // 要替换的文本
  new_string: string,     // 替换后的文本（必须不同于 old_string）
  replace_all: boolean    // 是否替换所有匹配（默认 false）
}
```

**ys-code (`EditInput`):**
```typescript
{
  file_path: string,      // 文件路径（相对于 cwd 解析）
  old_string: string,     // 要替换的文本
  new_string: string,     // 替换后的文本
  replace_all?: boolean   // 是否替换所有匹配（可选）
}
```

**差异：**
- cc 使用 `z.strictObject`，拒绝未知字段；ys-code 使用 `Type.Object`，允许额外字段
- cc 的 `replace_all` 通过 `semanticBoolean` 预处理，支持语义化布尔值；ys-code 直接使用布尔值
- cc 的路径在 `backfillObservableInput` 中通过 `expandPath` 展开为绝对路径；ys-code 在 `validateInput` 中解析

### 3.2 输出参数 Schema

**cc (`FileEditOutput`):**
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

**ys-code (`EditOutput`):**
```typescript
{
  filePath: string,
  oldString: string,
  newString: string,
  originalFile: string,
  replaceAll: boolean
}
```

**差异：**
- cc 包含 `structuredPatch`（用于 UI 渲染 diff）
- cc 包含 `userModified`（支持用户在权限提示中修改变更）
- cc 包含 `gitDiff`（远程模式下的 Git diff 信息）

### 3.3 校验逻辑 (`validateInput`) 对比

| 校验项 | cc | ys-code |
|--------|-----|---------|
| `old_string === new_string` | ✅ 返回错误码 1 | ✅ 返回错误码 1 |
| 团队内存文件 secrets 检查 | ✅ `checkTeamMemSecrets` | ❌ 无 |
| 权限规则检查（deny） | ✅ `matchingRuleForInput` | ❌ 无 |
| UNC 路径安全检查 | ✅ 跳过文件系统操作 | ❌ 无 |
| 文件大小限制（1GB） | ✅ 防止 OOM | ❌ 无 |
| 文件不存在 + `old_string === ""` | ✅ 允许创建 | ✅ 允许创建 |
| 文件存在 + `old_string === ""` | ✅ 仅当文件为空时允许 | ❌ 直接拒绝 |
| 文件不存在 + `old_string !== ""` | ✅ 提示相似文件建议 | ❌ 仅返回"文件不存在" |
| Jupyter Notebook 保护 | ✅ 拒绝，提示使用 `NotebookEditTool` | ❌ 无 |
| **必须先读取文件** | ✅ **强制要求**（核心安全机制） | ❌ **无此要求** |
| 文件修改时间戳检查 | ✅ 防止脏写 | ❌ 无 |
| 字符串匹配检查 | ✅ 使用 `findActualString`（支持引号规范化） | ✅ 直接 `includes` 检查 |
| 多匹配检测 | ✅ 支持 `replace_all` | ✅ 支持 `replace_all` |
| 设置文件编辑验证 | ✅ `validateInputForSettingsFileEdit` | ❌ 无 |

### 3.4 执行逻辑 (`call` / `execute`) 对比

| 执行步骤 | cc | ys-code |
|---------|-----|---------|
| 技能目录发现 | ✅ 自动发现并加载 | ❌ 无 |
| 诊断跟踪（LSP） | ✅ `diagnosticTracker.beforeFileEdited` | ❌ 无 |
| 父目录创建 | ✅ `fs.mkdir(dirname)` | ❌ 无 |
| 文件历史备份 | ✅ `fileHistoryTrackEdit` | ❌ 无 |
| 原子性保证 | ✅ 强调避免异步操作穿插 | ❌ 简单读写 |
| 文件编码处理 | ✅ 检测 utf16le / utf8 | ❌ 直接 utf-8 |
| 行尾符处理 | ✅ CRLF → LF | ❌ 无 |
| 引号规范化 | ✅ `findActualString` + `preserveQuoteStyle` | ❌ 无 |
| Patch 生成 | ✅ `getPatchForEdit`（结构化 diff） | ❌ 无 |
| LSP 通知 | ✅ `didChange` + `didSave` | ❌ 无 |
| VSCode 通知 | ✅ `notifyVscodeFileUpdated` | ❌ 无 |
| 读取时间戳更新 | ✅ 更新 `readFileState` | ❌ 无 |
| Git diff 获取 | ✅ 远程模式下可选 | ❌ 无 |
| 分析日志 | ✅ 多维度事件日志 | ❌ 无 |

### 3.5 UI 渲染对比

**cc：**
- `userFacingName`: 根据输入返回 "Create" / "Update" / "Updated plan"
- `renderToolUseMessage`: 显示文件路径链接（`FilePathLink`）
- `renderToolResultMessage`: 渲染完整 diff（`FileEditToolUpdatedMessage`）
- `renderToolUseRejectedMessage`: 渲染被拒绝的编辑 diff（含异步加载上下文）
- `renderToolUseErrorMessage`: 友好的错误提示（如 "File must be read first"）
- 支持 `verbose` / `condensed` 两种显示模式

**ys-code：**
- `formatResult`: 简单的文本返回
  - `replaceAll=true`: "The file {path} has been updated. All occurrences were successfully replaced."
  - `replaceAll=false`: "The file {path} has been updated successfully."

---

## 四、关键差异总结

### 4.1 ys-code 缺少的核心机制

1. **强制先读后写（Read-before-Write）**
   - cc 的核心安全机制：编辑前必须先通过 `FileReadTool` 读取文件
   - 防止模型在不了解文件内容的情况下盲目编辑
   - ys-code 无此限制，模型可直接编辑任何文件

2. **文件修改时间戳检查**
   - cc 记录文件读取时的时间戳和内容，编辑前对比
   - 防止用户或外部工具（如 linter）在读取后修改文件导致的脏写
   - ys-code 无此保护

3. **引号规范化**
   - cc 处理 curly quotes（`"` `'` `"` `'`）与 straight quotes 的转换
   - LLM 通常输出 straight quotes，但文件可能包含 curly quotes
   - ys-code 无此处理，可能导致匹配失败

4. **结构化 Patch / Diff 渲染**
   - cc 生成完整的结构化 diff patch，用于 UI 渲染变更对比
   - ys-code 仅返回简单的文本结果

5. **LSP / IDE 集成**
   - cc 在文件编辑后通知 LSP 服务器（`didChange` + `didSave`）
   - 触发 TypeScript 等语言的实时诊断
   - ys-code 无 IDE 集成

6. **权限系统深度集成**
   - cc 支持 alwaysAllow / alwaysDeny / alwaysAsk 规则
   - 支持基于路径模式的权限匹配
   - ys-code 仅有简单的 `checkPermissions` 接口

7. **文件历史备份**
   - cc 在编辑前自动备份原始内容
   - 支持后续恢复或查看历史
   - ys-code 无备份机制

### 4.2 ys-code 已具备的基础能力

| 能力 | 说明 |
|------|------|
| 基础字符串替换 | ✅ 支持单匹配和全匹配替换 |
| 新文件创建 | ✅ `old_string === ""` 时创建 |
| 参数校验 | ✅ `validateInput` 检查基本合法性 |
| 权限检查 | ✅ `checkPermissions` 接口 |
| 并发安全标记 | ✅ 可标记为不可并发 |
| 破坏性标记 | ✅ 可标记为破坏性操作 |

---

## 五、代码量对比

| 文件 | cc 行数 | ys-code 行数 |
|------|---------|-------------|
| 主工具文件 | ~625 (`FileEditTool.ts`) | ~155 (`edit.ts`) |
| 类型定义 | ~86 (`types.ts`) | ~25 (内联在 `edit.ts`) |
| 工具函数 | ~776 (`utils.ts`) | ~0 (无独立 utils) |
| UI 渲染 | ~289 (`UI.tsx`) | ~0 (无 UI 层) |
| Prompt/描述 | ~29 (`prompt.ts`) | ~0 (内联在 `edit.ts`) |
| **合计** | **~1805 行** | **~155 行** |

---

## 六、可借鉴的 cc 设计点

### 高优先级（建议尽快引入）

1. **强制先读后写机制**
   - 在 `validateInput` 中检查文件是否已被读取
   - 需要维护 `readFileState` 缓存

2. **文件修改时间戳检查**
   - 读取时记录时间戳和内容哈希
   - 编辑前对比，防止脏写

3. **引号规范化**
   - 引入 `findActualString` 和 `preserveQuoteStyle`
   - 处理 curly quotes 匹配问题

### 中优先级（后续逐步引入）

4. **结构化 Patch 生成**
   - 使用 `diff` 库生成结构化 patch
   - 为后续 UI 渲染做准备

5. **文件大小限制**
   - 防止大文件导致的 OOM

6. **新文件创建时的"文件已存在"保护**
   - 更精确的空文件判断逻辑

### 低优先级（根据需求决定）

7. LSP / IDE 集成
8. 文件历史备份
9. Git diff 获取
10. 完整的 UI 渲染层

---

## 七、附录：cc 核心文件源码结构

### `FileEditTool.ts`（主工具定义）

```
buildTool({
  name: FILE_EDIT_TOOL_NAME,          // "Edit"
  searchHint: 'modify file contents in place',
  maxResultSizeChars: 100_000,
  strict: true,
  
  // 描述和提示
  async description() { ... },
  async prompt() { ... },
  
  // 用户界面名称
  userFacingName,
  getToolUseSummary,
  getActivityDescription,
  
  // Schema
  get inputSchema() { ... },
  get outputSchema() { ... },
  
  // 输入处理
  toAutoClassifierInput,
  getPath,
  backfillObservableInput,
  preparePermissionMatcher,
  
  // 校验和权限
  async checkPermissions(...) { ... },
  async validateInput(...) { ... },
  inputsEquivalent,
  
  // 执行
  async call(...) { ... },
  
  // 结果映射
  mapToolResultToToolResultBlockParam,
  
  // UI 渲染
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
})
```

### `utils.ts`（核心工具函数）

| 函数 | 用途 |
|------|------|
| `normalizeQuotes` | 将 curly quotes 转为 straight quotes |
| `stripTrailingWhitespace` | 去除每行尾部空格 |
| `findActualString` | 在文件内容中查找匹配字符串（支持引号规范化） |
| `preserveQuoteStyle` | 将 straight quotes 转回 curly quotes |
| `applyEditToFile` | 执行实际的字符串替换 |
| `getPatchForEdit` | 为单次编辑生成 patch |
| `getPatchForEdits` | 为多次编辑生成 patch |
| `getSnippetForTwoFileDiff` | 获取 diff 片段（用于附件） |
| `getSnippetForPatch` | 从 patch 获取上下文片段 |
| `getSnippet` | 获取单次编辑的上下文片段 |
| `getEditsForPatch` | 从 patch 提取编辑列表 |
| `desanitizeMatchString` | 反规范化匹配字符串（处理 API 脱敏） |
| `normalizeFileEditInput` | 规范化输入（处理 trailing whitespace 等） |
| `areFileEditsEquivalent` | 比较两组编辑是否等价 |
| `areFileEditsInputsEquivalent` | 比较两个输入是否等价 |
