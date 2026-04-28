# CLAUDE.md 处理机制对齐 CC 设计

## 背景

YS-CODE 当前把 CLAUDE.md 内容通过 `relevant_memories` attachment 类型持久化到 session 中，导致：
1. 每次对话轮次都生成新的 attachment 消息并持久化
2. 恢复 session 后旧数据累积，Debug Inspector 看到大量重复的 attachment
3. CLAUDE.md 文件内容可能已更新，但 session 中持久化的是旧版本

## CC 原本的设计（基于源码）

### 1. 文件发现层（`claudemd.ts`）

CC 的 `getMemoryFiles()` 是一个 memoized 函数，负责发现所有记忆文件：

**文件类型（按优先级从低到高）：**
- **Managed**：`/etc/claude-code/CLAUDE.md` —— 全局策略设置
- **User**：`~/.claude/CLAUDE.md`、`~/.claude/rules/*.md` —— 用户私有全局指令
- **Project**：`CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md` —— 项目级指令（从 CWD 向上遍历到根目录）
- **Local**：`CLAUDE.local.md` —— 用户私有项目级指令（gitignored）

**核心发现逻辑：**
- 从当前目录 **向上遍历到根目录**，逐层读取上述文件
- 越靠近 CWD 的文件优先级越高（后加载的覆盖先加载的）
- `.claude/rules/*.md` **递归读取子目录**
- 支持 **`@include` 指令**：markdown 文件中可用 `@./path`、`@~/path`、`@/absolute/path` 引用其他文件（depth ≤ 5）
- 支持 **frontmatter 条件规则**：`.claude/rules/*.md` 可用 `paths:` frontmatter 指定 glob 模式，只匹配特定文件路径
- **HTML 注释剥离**：用 marked Lexer 去除 `<!-- -->` 块级注释
- **文件内容截断**：对特定类型文件做长度限制
- **排除模式**：支持 `claudeMdExcludes` 设置排除特定文件
- **symlink 处理**：safeResolvePath 解析符号链接
- **git worktree 嵌套处理**：避免重复加载

**过滤与拼接：**
- `filterInjectedMemoryFiles()`：当 feature flag 开启时过滤掉 AutoMem/TeamMem（用户已确认不需要 auto-memory）
- `getClaudeMds()`：将所有 MemoryFileInfo 拼接成单个字符串，格式为：
  ```
  Codebase and user instructions are shown below...
  
  Contents of /path/to/file.md (project instructions, checked into the codebase):
  
  <file content>
  ```

### 2. 上下文注入层（`context.ts` + `api.ts`）

**`getUserContext()` —— memoized 读取：**
- 使用 `lodash/memoize` 包装，进程生命周期内只执行一次
- 调用 `getMemoryFiles()` → `filterInjectedMemoryFiles()` → `getClaudeMds()`
- 结果包含 `claudeMd` 和 `currentDate`
- 缓存可通过 `getUserContext.cache.clear()` 手动清除

**`prependUserContext()` —— 动态注入：**
- 在**每次 API 调用前**执行
- 将 `getUserContext()` 的结果包装成 `<system-reminder>` 格式的 user message
- 标记 `isMeta: true`
- prepend 到 messages 最前面
- **不进入 session.messages，不写入磁盘**

### 3. 持久化层（`sessionStorage.ts`）

**attachment 不持久化：**
- `isLoggableMessage()` 明确过滤掉大多数 attachment：
  ```typescript
  if (m.type === 'attachment' && getUserType() !== 'ant') {
    return false; // 默认不持久化
  }
  ```
- 注释说明：`// attachment pushed to mutableMessages but never recordTranscript'd`
- 注释说明：`// Other message types (system, attachment) are metadata or auxiliary and shouldn't anchor a conversation chain.`

## YS-CODE 当前问题

| 文件 | 问题 |
|------|------|
| `src/utils/claudemd.ts` | 只读取当前目录的 `.claude/CLAUDE.md` 和 `.claude/rules/*.md`，缺少向上遍历、@include、frontmatter、条件规则等 |
| `src/agent/context/user-context.ts` | `getUserContextAttachments()` 将 userContext 包装成 `relevant_memories` attachment |
| `src/agent/stream-assistant.ts` | `generateAttachments()` 生成 relevant_memories → `saveAttachments()` 通过 `message_end` 持久化 |
| `src/agent/attachments/normalize.ts` | `relevant_memories` 分支生成 user message 但缺少 `isMeta: true`，且可能合并到普通 user message |
| `src/session/session-manager.ts` | `messageToEntry()` 将 `role === "attachment"` 的消息持久化为 `AttachmentEntry` |

## 设计方案

### 目标
1. 完全复刻 CC 的 `claudemd.ts` 文件发现逻辑（去掉 AutoMem/TeamMem/analytics/hooks/feature flags）
2. 改为 memoized `getUserContext()` + `prependUserContext()` 动态注入模式
3. 移除 `relevant_memories` attachment 类型
4. 所有 attachment（skill_listing、@mention）不持久化到 session store

### 文件变更清单

#### 新增文件

| 文件 | 职责 |
|------|------|
| `src/utils/frontmatter-parser.ts` | frontmatter 解析：`parseFrontmatter`、`splitPathInFrontmatter` |
| `src/utils/html-comment-stripper.ts` | HTML 注释剥离：基于 marked Lexer 去除 `<!-- -->` |
| `src/utils/path-comparison.ts` | 路径比较和规范化：`normalizePathForComparison`、`pathInWorkingPath` 等 |

#### 修改文件

| 文件 | 职责 |
|------|------|
| `src/utils/claudemd.ts` | **完全重构**。核心函数：`getMemoryFiles`（memoized）、`processMemoryFile`（含 @include）、`processMdRules`（递归读取 rules 目录）、`getClaudeMds`（拼接）、`filterInjectedMemoryFiles`、`parseMemoryFileContent` |
| `src/utils/fs-helpers.ts` | 新增 `safeResolvePath`、`getErrnoCode` 等辅助函数 |
| `src/agent/context/user-context.ts` | 删除 `getUserContextAttachments()`，重写 `prependUserContext()`，使用新的 `getMemoryFiles` + `getClaudeMds` |
| `src/agent/stream-assistant.ts` | 移除 `relevant_memories` 生成，改为 `prependUserContext` 注入；`saveAttachments` 仍然 emit 事件但 session 不持久化 |
| `src/agent/attachments/normalize.ts` | 移除 `relevant_memories` case |
| `src/agent/attachments/types.ts` | 从 Attachment union 中移除 `RelevantMemoriesAttachment` |
| `src/session/session-manager.ts` | `appendMessage()` 中忽略 `role === "attachment"` 的消息 |

### 关键数据流

#### 修改前
```
getUserContext()
  → getUserContextAttachments()       【生成 relevant_memories attachment】
  → generateAttachments()
  → saveAttachments()
  → emit message_end
  → SessionManager.appendMessage()    【持久化到磁盘】
  → buildApiPayload()
  → normalizeMessages()               【attachment → user message】
  → API
```

#### 修改后
```
getMemoryFiles() [memoized]           【完整复刻 CC 的文件发现逻辑】
  → getClaudeMds()                    【拼接成字符串】
  → getUserContext() [memoized]       【内存缓存，不持久化】

streamAssistantResponse():
  → generateAttachments()             【只生成 skill_listing + @mention】
  → saveAttachments()                 【emit 事件供 UI/Debug 查看，但不写入 session】
  → prependUserContext(allMessages)   【动态注入 CLAUDE.md，isMeta: true】
  → buildApiPayload()
  → normalizeMessages()
  → API
```

### 需要移除的 CC 功能

- `AutoMem` / `TeamMem` 类型（用户明确不需要 auto-memory）
- `analytics` / `logEvent` / `logForDiagnosticsNoPII`
- `InstructionsLoaded` hooks
- `feature()` / `GrowthBook` feature flags
- `getAdditionalDirectoriesForClaudeMd`（--add-dir）
- `shouldShowClaudeMdExternalIncludesWarning`（外部 include 警告）
- `getExternalClaudeMdIncludes`

## 验证标准

1. `bun run tsc --noEmit` 通过
2. `bun test` 全部通过
3. Debug Inspector 中 `session.messages` 不包含任何 `role: "attachment"` 的消息
4. `llmMessages` 中第一条消息是 `role: "user"` 且 `isMeta: true`，包含 `<system-reminder>` 包装的 CLAUDE.md 内容
5. 每轮对话后 session 文件不新增 attachment entry
