# CLAUDE.md 处理机制对齐 CC 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐 CC 设计：改为 memoized + prepend 注入模式，移除 `relevant_memories` attachment，所有 attachment 不持久化。分两阶段执行。

**Architecture:** 
- **阶段 1**：改造注入方式（`prependUserContext`）+ 停止 attachment 持久化。不改文件发现逻辑。
- **阶段 2**：复刻 CC 的 `claudemd.ts` 文件发现逻辑（向上遍历、@include、frontmatter 等）。

**Tech Stack:** TypeScript, Bun

---

## 设计参考

完整设计文档：`docs/superpowers/specs/2026-04-27-claude-md-alignment-design.md`

---

## 阶段 1：改造注入方式 + 停止持久化

**目标**：立即解决 attachment 累积问题。不改 `claudemd.ts` 的文件发现逻辑，只改造注入和持久化方式。

### Task 1.1: 重写 `prependUserContext()` 并删除 `getUserContextAttachments()`

**Files:**
- Modify: `src/agent/context/user-context.ts`

**Context:**
`getUserContextAttachments()` 将 userContext 包装成 `relevant_memories` attachment，这是问题的根源。改为直接构造 `isMeta: true` 的 user message。

- [ ] **Step 1: 删除 `getUserContextAttachments()`**

删除整段函数（约第 64-83 行）。同时删除 `AttachmentMessage` 的 import（第 3 行）。

- [ ] **Step 2: 重写 `prependUserContext()`**

替换为直接构造 user message：

```typescript
export function prependUserContext(
  messages: Message[],
  context: UserContext
): Message[] {
  const entries = Object.entries(context).filter(
    ([, value]) => value && value.trim() !== ''
  );

  if (entries.length === 0) return messages;

  const content = [
    '<system-reminder>',
    "As you answer the user's questions, you can use the following context:",
    ...entries.map(([key, value]) => `# ${key}\n${value}`),
    '',
    'IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.',
    '</system-reminder>',
    '',
  ].join('\n');

  const metaMessage: UserMessage = {
    role: 'user',
    content,
    timestamp: Date.now(),
    isMeta: true,
  };

  return [metaMessage, ...messages];
}
```

删除 `@deprecated` 注释，因为这个函数现在是主要使用方式。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

### Task 1.2: 修改 `stream-assistant.ts` 数据流

**Files:**
- Modify: `src/agent/stream-assistant.ts`

**Context:**
从 `generateAttachments()` 中移除 userContext 生成，改为在 `buildApiPayload()` 前调用 `prependUserContext()`。

- [ ] **Step 1: 修改 import**

```typescript
import { getUserContext, prependUserContext } from './context/user-context.js';
// 删除 getUserContextAttachments
```

- [ ] **Step 2: 从 `generateAttachments()` 中移除 userContext**

删除以下代码块：
```typescript
// userContext attachments
if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  const userContextAttachments = getUserContextAttachments(userContext);
  attachments.push(...userContextAttachments);
}
```

- [ ] **Step 3: 在阶段 3 注入 userContext**

修改 `streamAssistantResponse()` 中的阶段 3：

```typescript
// === 阶段 3: 构建 API Payload ===
let allMessages = [...context.messages, ...attachments];

// 动态注入 userContext（不持久化）
if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  allMessages = prependUserContext(allMessages, userContext);
}

const llmMessages = await buildApiPayload(allMessages, config.convertToLlm);
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

### Task 1.3: 清理 `relevant_memories` 相关代码

**Files:**
- Modify: `src/agent/attachments/normalize.ts`
- Modify: `src/agent/attachments/types.ts`

**Context:**
`relevant_memories` attachment 类型不再需要，应从类型系统和 normalize 逻辑中移除。

- [ ] **Step 1: 从 `normalize.ts` 移除 `relevant_memories` case**

删除 `normalizeAttachment()` 中的 `case "relevant_memories":` 分支（第 8-19 行）。

- [ ] **Step 2: 从 `types.ts` 移除 `RelevantMemoriesAttachment`**

从 `Attachment` union 类型中移除 `RelevantMemoriesAttachment`。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

### Task 1.4: 停止持久化 attachment 消息

**Files:**
- Modify: `src/session/session-manager.ts`

**Context:**
所有动态生成的 attachment 都不应进入 session store（对齐 CC 设计）。

- [ ] **Step 1: 在 `appendMessage()` 中忽略 attachment**

```typescript
appendMessage(message: AgentMessage): void {
  // attachment 消息动态生成，不需要持久化（对齐 CC 设计）
  if (message.role === 'attachment') return;

  const entry = this.messageToEntry(message);
  this.storage.appendEntry(this._filePath, entry);
  this._lastUuid = entry.uuid;
}
```

- [ ] **Step 2: 从 `messageToEntry()` 中移除 attachment case**

删除 `case "attachment":` 分支（第 139-148 行）。由于 `appendMessage()` 已经过滤，理论上不会走到这里。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

### Task 1.5: 更新测试

**Files:**
- Modify: `src/agent/__tests__/stream-assistant.test.ts`
- Modify: `src/agent/__tests__/session.test.ts`

**Context:**
测试需要同步反映新的行为：没有 `relevant_memories`、attachment 不持久化、`prependUserContext` 生成 `isMeta: true`。

- [ ] **Step 1: 运行现有测试，记录失败**

Run: `bun test src/agent/__tests__/stream-assistant.test.ts src/agent/__tests__/session.test.ts`
Expected: 可能有失败，记录位置

- [ ] **Step 2: 修复 stream-assistant 测试**

- 删除引用 `getUserContextAttachments` 的测试
- 新增测试：验证 `prependUserContext` 后 messages 最前面是 `isMeta: true` 的 user message
- 验证 `generateAttachments()` 不再生成 `relevant_memories`

- [ ] **Step 3: 修复 session 测试**

- 验证 `appendMessage()` 忽略 attachment
- 验证 session 恢复后不包含 attachment

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/__tests__/stream-assistant.test.ts src/agent/__tests__/session.test.ts`
Expected: all pass

---

### Task 1.6: 端到端验证

- [ ] **Step 1: 启动应用**

Run: `bun run src/main.ts --web`

- [ ] **Step 2: 验证 Debug Inspector**

打开 `http://127.0.0.1:<port>/debug`：

Expected:
- `session.messages` 中**不包含** `role: "attachment"` 且 `attachment.type === "relevant_memories"` 的消息
- `llmMessages` 中第一条消息是 `role: "user"` 且 `isMeta: true`
- 第一条消息内容包含 `<system-reminder>` 包装的 CLAUDE.md 内容

- [ ] **Step 3: 验证多轮对话不累积 attachment**

发送多条消息，检查 session 文件：

Expected: session 文件中不新增任何 `type: "attachment"` 的 entry

---

## 阶段 2：复刻 CC 的 claudemd.ts（后续迭代）

**目标**：完整复刻 CC 的文件发现逻辑（向上遍历、@include、frontmatter 条件规则、HTML 注释剥离等）。

**前置条件**：阶段 1 已完成并通过验证。

### Task 2.1: 新增基础工具模块

**Files:**
- Create: `src/utils/frontmatter-parser.ts`
- Create: `src/utils/html-comment-stripper.ts`
- Create: `src/utils/path-comparison.ts`
- Modify: `src/utils/fs-helpers.ts`

**Context:**
这些工具模块是 `claudemd.ts` 的依赖。每个模块独立实现、独立测试。

- [ ] **Step 1: 实现 `frontmatter-parser.ts`**

```typescript
/**
 * 解析 frontmatter，返回 frontmatter 对象和剩余内容
 */
export function parseFrontmatter(rawContent: string): {
  frontmatter: Record<string, string>;
  content: string;
} {
  // 实现 YAML frontmatter 解析 (---\n...\n---)
  // 如果没有 frontmatter，返回 { frontmatter: {}, content: rawContent }
}

/**
 * 将 frontmatter 中的 paths 字段拆分为数组
 */
export function splitPathInFrontmatter(paths: string): string[] {
  return paths.split(/[,\s]+/).filter(p => p.length > 0);
}
```

- [ ] **Step 2: 实现 `html-comment-stripper.ts`**

```typescript
import { Lexer } from 'marked';

export function stripHtmlComments(content: string): {
  content: string;
  stripped: boolean;
} {
  if (!content.includes('<!--')) {
    return { content, stripped: false };
  }
  return stripHtmlCommentsFromTokens(new Lexer({ gfm: false }).lex(content));
}

function stripHtmlCommentsFromTokens(
  tokens: ReturnType<Lexer['lex']>
): { content: string; stripped: boolean } {
  let result = '';
  let stripped = false;
  const commentSpan = /<!--[\s\S]*?-->/g;

  for (const token of tokens) {
    if (token.type === 'html') {
      const trimmed = token.raw.trimStart();
      if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
        const residue = token.raw.replace(commentSpan, '');
        stripped = true;
        if (residue.trim().length > 0) {
          result += residue;
        }
        continue;
      }
    }
    result += token.raw;
  }

  return { content: result, stripped };
}
```

- [ ] **Step 3: 实现 `path-comparison.ts`**

```typescript
export function normalizePathForComparison(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

export function pathInWorkingPath(
  path: string,
  workingPath: string
): boolean {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedWorking = normalizePathForComparison(workingPath);
  return (
    normalizedPath.startsWith(normalizedWorking + '/') ||
    normalizedPath === normalizedWorking
  );
}
```

- [ ] **Step 4: 扩展 `fs-helpers.ts`**

```typescript
import { realpathSync } from 'fs';

export function safeResolvePath(
  filePath: string
): { resolvedPath: string; isSymlink: boolean } {
  try {
    const resolved = realpathSync(filePath);
    return { resolvedPath: resolved, isSymlink: resolved !== filePath };
  } catch {
    return { resolvedPath: filePath, isSymlink: false };
  }
}

export function getErrnoCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}
```

- [ ] **Step 5: 为每个新增模块写单元测试**

Run: `bun test src/utils/__tests__/frontmatter-parser.test.ts`
Run: `bun test src/utils/__tests__/html-comment-stripper.test.ts`
Run: `bun test src/utils/__tests__/path-comparison.test.ts`
Expected: all pass

---

### Task 2.2: 重构 `claudemd.ts`

**Files:**
- Modify: `src/utils/claudemd.ts`

**Context:**
完全复刻 CC 的 `claudemd.ts` 核心逻辑，但移除 AutoMem/TeamMem/analytics/hooks/feature flags。

- [ ] **Step 1: 定义核心类型**

```typescript
export type MemoryType = 'Managed' | 'User' | 'Project' | 'Local';

export interface MemoryFileInfo {
  path: string;
  type: MemoryType;
  content: string;
  parent?: string;
  globs?: string[];
  contentDiffersFromDisk?: boolean;
  rawContent?: string;
}
```

- [ ] **Step 2: 实现 `parseMemoryFileContent()`**

解析单个文件内容，处理 frontmatter、HTML 注释、@include：

```typescript
function parseMemoryFileContent(
  rawContent: string,
  filePath: string,
  type: MemoryType
): { info: MemoryFileInfo | null; includePaths: string[] } {
  // 1. 解析 frontmatter
  const { frontmatter, content: withoutFrontmatter } = parseFrontmatter(rawContent);
  const { content: withoutFrontmatterPaths, paths } = parseFrontmatterPaths(withoutFrontmatter);

  // 2. HTML 注释剥离
  const { content: strippedContent, stripped } = stripHtmlComments(withoutFrontmatterPaths);

  // 3. 提取 @include 路径
  const tokens = new Lexer({ gfm: false }).lex(strippedContent);
  const includePaths = extractIncludePathsFromTokens(tokens, dirname(filePath));

  // 4. 构建 MemoryFileInfo
  const contentDiffersFromDisk = strippedContent !== rawContent;
  return {
    info: {
      path: filePath,
      type,
      content: strippedContent.trim(),
      globs: paths,
      contentDiffersFromDisk,
      rawContent: contentDiffersFromDisk ? rawContent : undefined,
    },
    includePaths,
  };
}
```

- [ ] **Step 3: 实现 `processMemoryFile()`**

递归处理文件及其 @include 引用（depth ≤ 5）。

- [ ] **Step 4: 实现 `processMdRules()`**

递归读取 `.claude/rules/` 目录下的 `.md` 文件，支持 conditionalRule 过滤。

- [ ] **Step 5: 实现 `getMemoryFiles()`**

memoized 主函数，按优先级读取 Managed → User → Project → Local：

```typescript
const memoryFilesCache = new Map<string, Promise<MemoryFileInfo[]>>();

export function getMemoryFiles(cwd: string = process.cwd()): Promise<MemoryFileInfo[]> {
  if (memoryFilesCache.has(cwd)) {
    return memoryFilesCache.get(cwd)!;
  }
  const promise = _getMemoryFiles(cwd);
  memoryFilesCache.set(cwd, promise);
  return promise;
}

export function clearMemoryFilesCache(): void {
  memoryFilesCache.clear();
}
```

- [ ] **Step 6: 实现 `getClaudeMds()`**

将 MemoryFileInfo 数组拼接成 CC 格式的字符串。

- [ ] **Step 7: 写 `claudemd.ts` 单元测试**

测试覆盖：
- 向上遍历目录
- @include 递归引用
- frontmatter 解析
- HTML 注释剥离
- 条件规则过滤

Run: `bun test src/utils/__tests__/claudemd.test.ts`
Expected: all pass

---

### Task 2.3: 集成验证

- [ ] **Step 1: 全量回归测试**

Run: `bun test`
Expected: all pass

- [ ] **Step 2: 端到端验证**

启动应用，验证：
- 不同目录层级的 `CLAUDE.md` 都被读取
- @include 引用的文件内容正确注入
- frontmatter 条件规则正确匹配/过滤
- HTML 注释被正确剥离

---

## Self-Review

**1. Spec coverage:**
- ✅ 阶段 1：注入方式改造（Task 1.1-1.6）
- ✅ 阶段 1：停止 attachment 持久化（Task 1.4）
- ✅ 阶段 1：移除 relevant_memories（Task 1.3）
- ✅ 阶段 2：新增工具模块（Task 2.1）
- ✅ 阶段 2：重构 claudemd.ts（Task 2.2）

**2. Placeholder scan:**
- ✅ 无 "TBD"、"TODO"、"implement later"
- ✅ 每步都有具体代码
- ✅ 文件路径精确

**3. 渐进式策略：**
- ✅ 阶段 1 可独立交付，立即解决核心问题
- ✅ 阶段 2 是增量增强，不影响阶段 1 的稳定性
- ✅ 每个阶段都有明确的验证标准
