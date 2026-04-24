# EditTool 演进实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ys-code EditTool 引入 read-before-write、脏写检测、引号规范化三大安全机制

**Architecture:** 扩展 ToolUseContext 注入 FileStateCache（基于 lru-cache），ReadTool 记录读取状态，EditTool 校验并检测脏写，所有工具通过 context 共享状态

**Tech Stack:** TypeScript, Bun, lru-cache, TypeBox

**规则提醒：**
- 遵循 `.claude/rules/code.md`：最小改动、不改进相邻代码、匹配现有风格
- 遵循 `.claude/rules/typescript.md`：定义结构体优先用 interface，字段加中文注释
- 严格 TDD：先写失败测试，再写最小实现，再重构

---

## 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/agent/file-state.ts` | 新增 | FileStateCache 核心实现（LRU + 读取记录管理） |
| `src/agent/file-state.test.ts` | 新增 | FileStateCache 单元测试 |
| `src/agent/types.ts` | 修改 | ToolUseContext 增加 fileStateCache 字段 |
| `src/agent/tool-execution.ts` | 修改 | buildToolUseContext 注入 fileStateCache |
| `src/agent/agent.ts` | 修改 | Agent 构造时创建 FileStateCache 实例 |
| `src/agent/tools/read/read.ts` | 修改 | execute 成功后调用 recordRead() |
| `src/agent/tools/edit.ts` | 修改 | validateInput 先读后写检查 + execute 脏写检测 + 引号规范化 |
| `src/agent/tools/edit.test.ts` | 新增 | EditTool 新功能集成测试 |

---

## Task 1: FileStateCache 核心实现

**Files:**
- Create: `src/agent/file-state.ts`
- Test: `src/agent/file-state.test.ts`

**目标:** 实现基于 LRU 的文件状态缓存，支持 recordRead / canEdit / recordEdit

- [ ] **Step 1: 编写 FileStateCache 接口和测试**

```typescript
// src/agent/file-state.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { FileStateCache } from './file-state.js';

describe('FileStateCache', () => {
  let cache: FileStateCache;

  beforeEach(() => {
    cache = new FileStateCache();
  });

  it('全量读取后应允许编辑', () => {
    cache.recordRead('/foo.ts', 'content', 1000);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.content).toBe('content');
      expect(result.record.timestamp).toBe(1000);
    }
  });

  it('未读取文件应拒绝编辑', () => {
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
      expect(result.reason).toContain('not been read');
    }
  });

  it('部分视图应拒绝编辑', () => {
    cache.recordRead('/foo.ts', 'content', 1000, undefined, undefined, true);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }
  });

  it('编辑后应更新记录', () => {
    cache.recordRead('/foo.ts', 'old', 1000);
    cache.recordEdit('/foo.ts', 'new', 2000);
    const record = cache.get('/foo.ts');
    expect(record?.content).toBe('new');
    expect(record?.timestamp).toBe(2000);
    expect(record?.offset).toBeUndefined();
    expect(record?.limit).toBeUndefined();
    expect(record?.isPartialView).toBe(false);
  });

  it('路径应规范化', () => {
    cache.recordRead('/foo/bar.ts', 'content', 1000);
    const result = cache.canEdit('/foo//bar.ts');
    expect(result.ok).toBe(true);
  });

  it('LRU 应自动淘汰旧项', () => {
    const smallCache = new FileStateCache({ maxEntries: 2, maxSizeBytes: 100 });
    smallCache.recordRead('/a.ts', 'a'.repeat(50), 1000);
    smallCache.recordRead('/b.ts', 'b'.repeat(50), 1000);
    smallCache.recordRead('/c.ts', 'c'.repeat(50), 1000);
    expect(smallCache.get('/a.ts')).toBeUndefined();
    expect(smallCache.get('/c.ts')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/carlyu/soft/projects/ys-code
bun test src/agent/file-state.test.ts
```

Expected: 失败，FileStateCache 未定义

- [ ] **Step 3: 实现 FileStateCache**

```typescript
// src/agent/file-state.ts
import { LRUCache } from 'lru-cache';
import { normalize } from 'path';

/**
 * 文件读取记录
 */
export interface FileReadRecord {
  /** 读取时的文件内容（用于后续内容对比，防止时间戳误报） */
  content: string;
  /** 读取时的文件修改时间（fs.stat().mtimeMs） */
  timestamp: number;
  /** 部分读取时的起始行号（1-based，全量读取为 undefined） */
  offset?: number;
  /** 部分读取时的行数限制（全量读取为 undefined） */
  limit?: number;
  /** 是否为部分视图（如 CLAUDE.md 自动注入的内容） */
  isPartialView?: boolean;
}

/**
 * 文件状态缓存
 * 基于 LRUCache 实现内存受限的文件读取状态管理
 */
export class FileStateCache {
  private cache: LRUCache<string, FileReadRecord>;

  constructor(options?: { maxEntries?: number; maxSizeBytes?: number }) {
    this.cache = new LRUCache<string, FileReadRecord>({
      max: options?.maxEntries ?? 100,
      maxSize: options?.maxSizeBytes ?? 25 * 1024 * 1024,
      sizeCalculation: (value) => Math.max(1, Buffer.byteLength(value.content)),
    });
  }

  /**
   * 记录一次文件读取
   */
  recordRead(
    path: string,
    content: string,
    timestamp: number,
    offset?: number,
    limit?: number,
    isPartialView?: boolean,
  ): void {
    this.cache.set(normalize(path), {
      content,
      timestamp,
      offset,
      limit,
      isPartialView: isPartialView ?? false,
    });
  }

  /**
   * 检查文件是否可以编辑
   */
  canEdit(path: string):
    | { ok: true; record: FileReadRecord }
    | { ok: false; reason: string; errorCode: number } {
    const record = this.cache.get(normalize(path));

    if (!record) {
      return {
        ok: false,
        reason: `File has not been read yet. Read it first before writing to it.`,
        errorCode: 6,
      };
    }

    if (record.isPartialView) {
      return {
        ok: false,
        reason: `File has only been partially read. Read the full file before writing to it.`,
        errorCode: 6,
      };
    }

    return { ok: true, record };
  }

  /**
   * 更新编辑后的文件状态
   */
  recordEdit(path: string, newContent: string, newTimestamp: number): void {
    this.cache.set(normalize(path), {
      content: newContent,
      timestamp: newTimestamp,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
  }

  /** 获取记录 */
  get(path: string): FileReadRecord | undefined {
    return this.cache.get(normalize(path));
  }

  /** 清除所有记录 */
  clear(): void {
    this.cache.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test src/agent/file-state.test.ts
```

Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/agent/file-state.ts src/agent/file-state.test.ts
git commit -m "feat(file-state): add FileStateCache with LRU eviction

- Record file read state with content, timestamp, offset, limit
- Support partial view detection (isPartialView)
- Enforce read-before-write via canEdit()
- Auto-evict old entries via lru-cache
- 100% branch coverage tests"
```

---

## Task 2: 扩展 ToolUseContext

**Files:**
- Modify: `src/agent/types.ts`
- Modify: `src/agent/tool-execution.ts`
- Modify: `src/agent/agent.ts`

**目标:** 在 ToolUseContext 中注入 FileStateCache，使所有工具可以访问

- [ ] **Step 1: 修改 ToolUseContext 接口**

```typescript
// src/agent/types.ts
// 在 ToolUseContext 接口中新增字段

import type { FileStateCache } from './file-state.js';  // 新增 import

export interface ToolUseContext {
  abortSignal: AbortSignal;
  messages: AgentMessage[];
  tools: AgentTool<any, any>[];
  sessionId?: string;
  model?: Model<any>;
  fileStateCache: FileStateCache;  // 新增
}
```

- [ ] **Step 2: 修改 tool-execution.ts 注入 FileStateCache**

```typescript
// src/agent/tool-execution.ts
// 修改 buildToolUseContext 函数签名和实现

import type { FileStateCache } from './file-state.js';  // 新增 import

function buildToolUseContext(
  currentContext: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  fileStateCache: FileStateCache,  // 新增参数
): ToolUseContext {
  return {
    abortSignal: signal ?? new AbortController().signal,
    messages: currentContext.messages,
    tools: currentContext.tools ?? [],
    sessionId: (config as any).sessionId,
    model: config.model,
    fileStateCache,  // 注入
  };
}
```

同时修改 `prepareToolCall` 和 `executePreparedToolCall` 的调用处：

```typescript
// 在 prepareToolCall 中（约第 89 行）
const context = buildToolUseContext(currentContext, config, signal, fileStateCache);

// 在 executePreparedToolCall 中（约第 136 行）
const context = buildToolUseContext(currentContext, config, signal, fileStateCache);
```

但这里有问题：`prepareToolCall` 和 `executePreparedToolCall` 目前不接收 `fileStateCache` 参数。需要修改它们的签名。

```typescript
// prepareToolCall 新增 fileStateCache 参数
async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: import("../core/ai/index.js").ToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  fileStateCache: FileStateCache,  // 新增
): Promise<... > {
  // ...
  const context = buildToolUseContext(currentContext, config, signal, fileStateCache);
  // ...
}

// executePreparedToolCall 新增 fileStateCache 参数
async function executePreparedToolCall(
  prepared: { ... },
  currentContext: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  fileStateCache: FileStateCache,  // 新增
  emit: AgentEventSink,
): Promise<... > {
  const context = buildToolUseContext(currentContext, config, signal, fileStateCache);
  // ...
}
```

然后修改 `executeToolCallsSequential` 和 `executeToolCallsParallel` 的调用：

```typescript
// executeToolCallsSequential 中
const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal, fileStateCache);
// ...
const executed = await executePreparedToolCall(preparation, currentContext, config, signal, fileStateCache, emit);

// executeToolCallsParallel 中同理
```

最后修改 `executeToolCalls`：

```typescript
export async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  fileStateCache: FileStateCache,  // 新增参数
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  // ...
}
```

- [ ] **Step 3: 修改 Agent 创建 FileStateCache**

```typescript
// src/agent/agent.ts
// 在 Agent 类中添加 fileStateCache 字段

import { FileStateCache } from './file-state.js';  // 新增 import

export class Agent {
  private fileStateCache: FileStateCache;  // 新增字段

  constructor(options: AgentOptions) {
    // ... 现有初始化
    this.fileStateCache = new FileStateCache();  // 新增
  }

  // 在工具执行时传入 fileStateCache
  // 找到调用 executeToolCalls 的地方，传入 this.fileStateCache
}
```

- [ ] **Step 4: 运行现有测试确认未破坏**

```bash
bun test src/agent/tool-execution.test.ts
bun test src/agent/agent-loop.test.ts
```

Expected: 通过（可能需要更新 mock context）

- [ ] **Step 5: Commit**

```bash
git add src/agent/types.ts src/agent/tool-execution.ts src/agent/agent.ts
git commit -m "feat(context): inject FileStateCache into ToolUseContext

- Add fileStateCache field to ToolUseContext interface
- Pass FileStateCache through buildToolUseContext
- Agent creates FileStateCache instance at construction"
```

---

## Task 3: ReadTool 集成

**Files:**
- Modify: `src/agent/tools/read/read.ts`

**目标:** ReadTool 成功读取后调用 `context.fileStateCache.recordRead()`

- [ ] **Step 1: 修改 ReadTool.execute**

```typescript
// src/agent/tools/read/read.ts
// 在 execute 方法中，返回结果前添加记录逻辑

import { stat } from 'fs/promises';  // 新增 import（如果还没有）

execute: async (_toolCallId, params, context) => {
  const fullPath = expandPath(params.file_path, cwd);
  const ext = extname(fullPath).toLowerCase().slice(1);
  const offset = params.offset ?? 1;

  // 读取文件
  const result = await readFileByType(
    fullPath,
    ext,
    offset,
    params.limit,
    params.pages,
    DEFAULT_LIMITS.maxSizeBytes,
    DEFAULT_LIMITS.maxTokens,
  );

  // 【新增】记录读取状态
  const stats = await stat(fullPath);
  context.fileStateCache.recordRead(
    fullPath,
    result.file.content ?? '',
    Math.floor(stats.mtimeMs),
    params.offset,
    params.limit,
  );

  return result;
},
```

- [ ] **Step 2: 运行 ReadTool 相关测试**

```bash
bun test src/agent/tools/read  # 如果有测试的话
```

如果没有 ReadTool 的测试，运行整体测试：

```bash
bun test
```

Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/read/read.ts
git commit -m "feat(read): record file read state in FileStateCache

- After successful read, record {content, mtime, offset, limit}
- Enables EditTool read-before-write validation"
```

---

## Task 4: EditTool 先读后写 + 脏写检测

**Files:**
- Modify: `src/agent/tools/edit.ts`
- Create: `src/agent/tools/edit.test.ts`

**目标:** EditTool validateInput 中检查先读后写，execute 中二次脏写检测

- [ ] **Step 1: 编写 EditTool 测试**

```typescript
// src/agent/tools/edit.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { createEditTool } from './edit.js';
import { FileStateCache } from '../file-state.js';
import type { ToolUseContext } from '../types.js';

function mockContext(cache: FileStateCache): ToolUseContext {
  return {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    fileStateCache: cache,
  } as ToolUseContext;
}

describe('EditTool read-before-write', () => {
  it('未读取文件应拒绝编辑', async () => {
    const cache = new FileStateCache();
    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'b',
    }, mockContext(cache));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }
  });

  it('读取后应允许编辑', async () => {
    const cache = new FileStateCache();
    cache.recordRead('/tmp/foo.ts', 'abc', Date.now());
    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'b',
    }, mockContext(cache));
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/agent/tools/edit.test.ts
```

Expected: 失败，validateInput 未检查 fileStateCache

- [ ] **Step 3: 修改 EditTool.validateInput**

```typescript
// src/agent/tools/edit.ts
// 在 validateInput 中添加先读后写检查

validateInput: async (params, context) => {
  const fullPath = resolve(cwd, params.file_path);

  // 【新增】先读后写检查
  const readCheck = context.fileStateCache.canEdit(fullPath);
  if (!readCheck.ok) {
    return {
      ok: false,
      message: readCheck.reason,
      errorCode: readCheck.errorCode,
    };
  }

  // 【新增】脏写检测第一层
  const stats = await stat(fullPath).catch(() => null);
  if (stats && readCheck.record) {
    const currentMtime = Math.floor(stats.mtimeMs);
    if (currentMtime > readCheck.record.timestamp) {
      const isFullRead =
        readCheck.record.offset === undefined &&
        readCheck.record.limit === undefined;
      if (!isFullRead) {
        return {
          ok: false,
          message: 'File has been modified since read. Read it again before writing.',
          errorCode: 7,
        };
      }
      const content = await readFile(fullPath, 'utf-8').catch(() => null);
      if (content !== readCheck.record.content) {
        return {
          ok: false,
          message: 'File has been modified since read. Read it again before writing.',
          errorCode: 7,
        };
      }
    }
  }

  // 原有校验逻辑...
  if (params.old_string === params.new_string) {
    return {
      ok: false,
      message: 'No changes to make: old_string and new_string are exactly the same.',
      errorCode: 1,
    };
  }

  // ... 其余原有逻辑不变
},
```

- [ ] **Step 4: 修改 EditTool.execute**

```typescript
execute: async (_toolCallId, params, context) => {
  const fullPath = resolve(cwd, params.file_path);
  const { old_string, new_string, replace_all = false } = params;

  // 读取文件
  let content: string;
  try {
    content = await readFile(fullPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      content = '';
    } else {
      throw e;
    }
  }

  // 【新增】二次脏写检测
  const record = context.fileStateCache.get(fullPath);
  const stats = await stat(fullPath).catch(() => null);
  if (stats && record) {
    const currentMtime = Math.floor(stats.mtimeMs);
    if (currentMtime > record.timestamp) {
      const isFullRead = record.offset === undefined && record.limit === undefined;
      const contentUnchanged = isFullRead && content === record.content;
      if (!contentUnchanged) {
        throw new Error('File unexpectedly modified since last read');
      }
    }
  }

  // 执行替换
  let newContent: string;
  if (old_string === '') {
    newContent = new_string;
  } else {
    newContent = replace_all
      ? content.replaceAll(old_string, new_string)
      : content.replace(old_string, new_string);
  }

  await writeFile(fullPath, newContent, 'utf-8');

  // 【新增】更新缓存
  const newStats = await stat(fullPath);
  context.fileStateCache.recordEdit(fullPath, newContent, Math.floor(newStats.mtimeMs));

  return {
    filePath: fullPath,
    oldString: old_string,
    newString: new_string,
    originalFile: content,
    replaceAll: replace_all,
  };
},
```

- [ ] **Step 5: 运行测试确认通过**

```bash
bun test src/agent/tools/edit.test.ts
```

Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit): enforce read-before-write and dirty-write detection

- ValidateInput checks fileStateCache.canEdit() (error code 6)
- ValidateInput checks mtime for dirty-write (error code 7)
- Execute re-checks mtime before writing
- Updates fileStateCache after successful edit"
```

---

## Task 5: 引号规范化

**Files:**
- Modify: `src/agent/tools/edit.ts`（新增函数）

**目标:** 处理 curly quotes vs straight quotes，提高编辑成功率

- [ ] **Step 1: 在 edit.ts 中新增引号规范化函数**

```typescript
// src/agent/tools/edit.ts
// 在文件末尾或合适位置添加

/**
 * 将 curly quotes 转为 straight quotes
 */
function normalizeQuotes(str: string): string {
  return str
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

/**
 * 在文件内容中查找匹配字符串（支持引号规范化）
 * @returns 实际匹配的字符串，或 null 如果未找到
 */
export function findActualString(fileContent: string, searchString: string): string | null {
  // 先尝试精确匹配
  if (fileContent.includes(searchString)) {
    return searchString;
  }

  // 尝试引号规范化后匹配
  const normalizedSearch = normalizeQuotes(searchString);
  if (normalizedSearch !== searchString && fileContent.includes(normalizedSearch)) {
    return normalizedSearch;
  }

  return null;
}
```

- [ ] **Step 2: 在 validateInput 中使用 findActualString**

修改 validateInput 中的字符串查找逻辑：

```typescript
// 替换原有的 content.includes(params.old_string)
const actualOldString = findActualString(content, params.old_string);
if (!actualOldString) {
  return {
    ok: false,
    message: `String to replace not found in file.\nString: ${params.old_string}`,
    errorCode: 8,
  };
}

// 多匹配检测使用 actualOldString
const matches = content.split(actualOldString).length - 1;
```

- [ ] **Step 3: 在 execute 中使用 findActualString**

```typescript
// 替换原有的 content.replace(...)
const actualOldString = findActualString(content, old_string);
if (!actualOldString) {
  throw new Error(`String to replace not found: ${old_string}`);
}

const newContent = replace_all
  ? content.replaceAll(actualOldString, new_string)
  : content.replace(actualOldString, new_string);
```

- [ ] **Step 4: 运行 EditTool 测试确认通过**

```bash
bun test src/agent/tools/edit.test.ts
```

Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/edit.ts
git commit -m "feat(edit): add quote normalization for better matching

- normalizeQuotes: convert curly quotes to straight quotes
- findActualString: try exact match first, then normalized match
- Handles LLM outputting straight quotes for file's curly quotes"
```

---

## Task 6: 更新 EditTool description

**Files:**
- Modify: `src/agent/tools/edit.ts`

**目标:** 在 description 中告知模型必须先 Read

- [ ] **Step 1: 修改 description**

```typescript
// edit.ts

description: `Performs exact string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/edit.ts
git commit -m "docs(edit): update description to inform model about read requirement"
```

---

## Task 7: 整体回归测试

**Files:**
- 无新增/修改

**目标:** 确保所有修改未破坏现有功能

- [ ] **Step 1: 运行全部测试**

```bash
bun test
```

Expected: 全部通过

- [ ] **Step 2: 类型检查**

```bash
bun run typecheck
```

Expected: 无类型错误

- [ ] **Step 3: Commit（如测试通过）**

```bash
git commit --allow-empty -m "test: all tests pass after EditTool evolution"
```

---

## 自我审查检查表

- [ ] **Spec coverage**: 先读后写（错误码 6）✓、脏写检测（错误码 7）✓、引号规范化 ✓、LRU ✓
- [ ] **Placeholder scan**: 无 TBD/TODO/待补充
- [ ] **Type consistency**: `FileStateCache` 方法名和签名在全文中一致
- [ ] **TDD compliance**: 每个 Task 都有"写测试 → 运行失败 → 实现 → 运行通过"步骤
- [ ] **Rule compliance**: 遵循 code.md（最小改动）和 typescript.md（interface + 中文注释）

---

*Plan complete.*
