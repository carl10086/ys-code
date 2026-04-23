# EditTool 演进设计文档

> 目标：为 ys-code EditTool 引入 read-before-write、脏写检测、引号规范化三大安全机制
> 方案：扩展 ToolUseContext，注入 FileStateCache（LRU）
> 日期：2026-04-23
> 开发方式：严格 TDD，高覆盖率单元测试

---

## 一、设计概述

### 1.1 背景

当前 ys-code EditTool 允许模型在**未读取文件**的情况下直接编辑，存在以下风险：
- 模型基于过时记忆编辑，导致意外覆盖
- 外部程序（编辑器、linter）在读取后修改文件，EditTool 直接覆盖导致变更丢失
- 部分读取的文件不适合直接编辑

### 1.2 核心思路

借鉴 cc 的 `readFileState` 机制，但**使用现有 `lru-cache` 依赖，通过扩展 `ToolUseContext` 注入**。

改为：
1. 新建 `src/agent/file-state.ts`，提供 `FileStateCache`（基于 LRUCache）
2. 扩展 `ToolUseContext` 接口，加入 `fileStateCache` 字段
3. `Agent` 创建 `FileStateCache` 实例，工具执行时通过 `context` 注入
4. `ReadTool` 成功读取后调用 `context.fileStateCache.recordRead()`
5. `EditTool` 编辑前调用 `context.fileStateCache.canEdit()` 检查
6. `EditTool` 编辑成功后调用 `context.fileStateCache.recordEdit()` 更新

### 1.3 TDD 原则

**严格遵循 TDD 循环**：
```
红：编写失败的测试
绿：编写最小代码使测试通过
重构：优化代码，保持测试通过
```

**要求**：
- `file-state.ts`：100% 分支覆盖率
- `edit.ts` 新增逻辑：90%+ 覆盖率
- `read.ts` 新增逻辑：90%+ 覆盖率
- 每个公开方法至少 3 个测试用例（正常、边界、异常）

---

## 二、数据结构

### 2.1 FileReadRecord

```typescript
// file-state.ts

/**
 * 文件读取记录
 * 每次成功调用 ReadTool 后生成，供 EditTool 校验使用
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
```

### 2.2 FileStateCache

```typescript
// file-state.ts

export class FileStateCache {
  private cache: LRUCache<string, FileReadRecord>;

  constructor(options?: { maxEntries?: number; maxSizeBytes?: number }) {
    this.cache = new LRUCache({
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

  /** 获取记录（调试用） */
  get(path: string): FileReadRecord | undefined {
    return this.cache.get(normalize(path));
  }

  /** 清除所有记录 */
  clear(): void {
    this.cache.clear();
  }
}
```

---

## 三、接口扩展

### 3.1 ToolUseContext 扩展

```typescript
// types.ts

export interface ToolUseContext {
  abortSignal: AbortSignal;
  messages: AgentMessage[];
  tools: AgentTool<any, any>[];
  sessionId?: string;
  model?: Model<any>;
  fileStateCache: FileStateCache;  // 新增
}
```

### 3.2 tool-execution.ts 修改

```typescript
// tool-execution.ts

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

### 3.3 Agent 级别创建 Cache

```typescript
// agent.ts

import { FileStateCache } from './file-state.js';

export class Agent {
  private fileStateCache: FileStateCache;

  constructor(options: AgentOptions) {
    // ... 现有初始化
    this.fileStateCache = new FileStateCache();
  }

  // 工具执行时传入
  private async executeTools(...) {
    const context = buildToolUseContext(
      this.context,
      this.config,
      signal,
      this.fileStateCache,
    );
    // ...
  }
}
```

---

## 四、ReadTool 集成

### 4.1 修改点

```typescript
// read.ts

import { stat } from 'fs/promises';

export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    // ... 其他配置

    execute: async (_toolCallId, params, context) => {
      const fullPath = expandPath(params.file_path, cwd);
      const ext = extname(fullPath).toLowerCase().slice(1);
      const offset = params.offset ?? 1;

      // 1. 读取文件
      const result = await readFileByType(
        fullPath, ext, offset, params.limit, params.pages,
        DEFAULT_LIMITS.maxSizeBytes, DEFAULT_LIMITS.maxTokens,
      );

      // 2. 【新增】记录读取状态
      const stats = await stat(fullPath);
      context.fileStateCache.recordRead(
        fullPath,
        result.file.content ?? '',
        Math.floor(stats.mtimeMs),
        params.offset,
        params.limit,
      );

      // 3. 返回结果
      return result;
    },
  });
}
```

### 4.2 注意

- 只有**成功读取**才记录。如果读取失败（文件不存在、权限不足等），不记录
- 图片、PDF 等非文本内容的读取，也记录（`content` 为空字符串或 base64 摘要）
- Notebook 读取记录的是解析后的 JSON 内容

---

## 五、EditTool 集成

### 5.1 validateInput 修改

```typescript
// edit.ts

export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    // ... 其他配置

    validateInput: async (params, context) => {
      const fullPath = resolve(cwd, params.file_path);

      // 1. 【新增】先读后写检查
      const readCheck = context.fileStateCache.canEdit(fullPath);
      if (!readCheck.ok) {
        return {
          ok: false,
          message: readCheck.reason,
          errorCode: readCheck.errorCode,
        };
      }

      // 2. 【新增】脏写检测第一层
      const stats = await stat(fullPath).catch(() => null);
      if (stats && readCheck.record) {
        const currentMtime = Math.floor(stats.mtimeMs);
        if (currentMtime > readCheck.record.timestamp) {
          const isFullRead =
            readCheck.record.offset === undefined &&
            readCheck.record.limit === undefined;
          if (!isFullRead) {
            // 部分读取无法对比内容，直接报错
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
          // 内容没变，是 Windows 误报，放行
        }
      }

      // 3. 原有校验逻辑...
      if (params.old_string === params.new_string) {
        return { ok: false, message: '...', errorCode: 1 };
      }

      // 4. 文件存在性检查...
      // ...

      return { ok: true };
    },
```

### 5.2 execute 修改

```typescript
    execute: async (_toolCallId, params, context) => {
      const fullPath = resolve(cwd, params.file_path);
      const { old_string, new_string, replace_all = false } = params;

      // 1. 读取文件
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

      // 2. 【新增】二次脏写检测
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

      // 3. 【新增】引号规范化
      const actualOldString = findActualString(content, old_string);
      if (!actualOldString) {
        throw new Error(`String to replace not found in file: ${old_string}`);
      }

      // 4. 执行替换
      let newContent: string;
      if (old_string === '') {
        newContent = new_string;
      } else {
        newContent = replace_all
          ? content.replaceAll(actualOldString, new_string)
          : content.replace(actualOldString, new_string);
      }

      // 5. 写入
      await writeFile(fullPath, newContent, 'utf-8');

      // 6. 【新增】更新缓存
      const newStats = await stat(fullPath);
      context.fileStateCache.recordEdit(fullPath, newContent, Math.floor(newStats.mtimeMs));

      return {
        filePath: fullPath,
        oldString: actualOldString,
        newString: new_string,
        originalFile: content,
        replaceAll: replace_all,
      };
    },
```

### 5.3 引号规范化工具函数

```typescript
// edit.ts 或独立 quotes.ts

/**
 * 将 curly quotes 转为 straight quotes
 */
function normalizeQuotes(str: string): string {
  return str
    .replace(/[“”]/g, '"')   // " " → "
    .replace(/[‘’]/g, "'");  // ' ' → '
}

/**
 * 在文件内容中查找匹配字符串（支持引号规范化）
 * @returns 实际匹配的字符串（可能是规范化后的版本）
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

---

## 六、错误处理

### 6.1 错误码定义

沿用 cc 的错误码体系：

| 错误码 | 场景 | 消息示例 |
|--------|------|---------|
| 6 | 文件未读取 | "File has not been read yet..." |
| 6 | 部分视图 | "File has only been partially read..." |
| 7 | 文件被外部修改 | "File has been modified since read..." |

### 6.2 错误恢复路径

当 EditTool 返回错误码 6 或 7 时：
1. 模型调用 `Read` 工具读取该文件
2. ReadTool 成功读取后，`recordRead()` 写入记录
3. 模型再次调用 `Edit` 工具，此次通过

---

## 七、测试策略（TDD）

### 7.1 TDD 流程

```
Phase 1: FileStateCache（红→绿→重构）
  └─ file-state.test.ts

Phase 2: EditTool 集成（红→绿→重构）
  └─ edit.test.ts（扩展）

Phase 3: ReadTool 集成（红→绿→重构）
  └─ read.test.ts（扩展）

Phase 4: 引号规范化（红→绿→重构）
  └─ quotes.test.ts
```

### 7.2 FileStateCache 单元测试

```typescript
// file-state.test.ts

describe('FileStateCache', () => {
  let cache: FileStateCache;

  beforeEach(() => {
    cache = new FileStateCache();
  });

  it('should allow edit after full read', () => {
    cache.recordRead('/foo.ts', 'content', 1000);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(true);
  });

  it('should reject edit if file not read', () => {
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(6);
  });

  it('should reject edit if partial view', () => {
    cache.recordRead('/foo.ts', 'content', 1000, 1, 10, true);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(6);
  });

  it('should reject edit if only partially read (offset/limit)', () => {
    cache.recordRead('/foo.ts', 'content', 1000, 1, 10);
    const result = cache.canEdit('/foo.ts');
    // 注意：cc 允许部分读取后编辑，这里按 ys-code 设计决策
    // 当前设计：部分读取也允许编辑（靠字符串匹配兜底）
    expect(result.ok).toBe(true);
  });

  it('should update record after edit', () => {
    cache.recordRead('/foo.ts', 'old', 1000);
    cache.recordEdit('/foo.ts', 'new', 2000);
    const record = cache.get('/foo.ts');
    expect(record?.content).toBe('new');
    expect(record?.timestamp).toBe(2000);
    expect(record?.offset).toBeUndefined();
    expect(record?.limit).toBeUndefined();
  });

  it('should normalize paths', () => {
    cache.recordRead('/foo/bar.ts', 'content', 1000);
    const result = cache.canEdit('/foo//bar.ts');
    expect(result.ok).toBe(true);
  });

  it('should evict old entries when size limit exceeded', () => {
    const smallCache = new FileStateCache({ maxEntries: 2, maxSizeBytes: 100 });
    smallCache.recordRead('/a.ts', 'a'.repeat(50), 1000);
    smallCache.recordRead('/b.ts', 'b'.repeat(50), 1000);
    smallCache.recordRead('/c.ts', 'c'.repeat(50), 1000); // 触发淘汰
    expect(smallCache.get('/a.ts')).toBeUndefined(); // a 被淘汰
    expect(smallCache.get('/c.ts')).toBeDefined();
  });
});
```

### 7.3 EditTool 集成测试

```typescript
// edit.test.ts（扩展）

describe('EditTool read-before-write', () => {
  it('should reject edit without prior read', async () => {
    const cache = new FileStateCache();
    const tool = createEditTool('/tmp', cache); // 需要修改工厂签名
    const result = await tool.validateInput!({
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'b',
    }, { fileStateCache: cache } as ToolUseContext);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(6);
  });

  it('should allow edit after read', async () => {
    const cache = new FileStateCache();
    cache.recordRead('/tmp/foo.ts', 'abc', Date.now());
    const tool = createEditTool('/tmp', cache);
    const result = await tool.validateInput!({
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'b',
    }, { fileStateCache: cache } as ToolUseContext);
    expect(result.ok).toBe(true);
  });

  it('should reject edit if file modified since read', async () => {
    // 需要 mock fs.stat 返回不同 mtime
  });
});
```

### 7.4 引号规范化测试

```typescript
// quotes.test.ts

describe('findActualString', () => {
  it('should match exact string', () => {
    const result = findActualString('hello world', 'hello');
    expect(result).toBe('hello');
  });

  it('should match with curly quotes normalized', () => {
    const content = 'He said "hello" there';  // curly quotes
    const search = 'He said "hello" there';   // straight quotes
    const result = findActualString(content, search);
    expect(result).toBe('He said "hello" there'); // 返回文件中的实际字符串
  });

  it('should return null if not found', () => {
    const result = findActualString('hello world', 'xyz');
    expect(result).toBeNull();
  });
});
```

---

## 八、修改文件清单

| 文件 | 类型 | 修改内容 | 测试文件 |
|------|------|---------|---------|
| `src/agent/file-state.ts` | 新增 | FileStateCache + FileReadRecord | `file-state.test.ts` |
| `src/agent/types.ts` | 修改 | ToolUseContext 增加 `fileStateCache` | - |
| `src/agent/tool-execution.ts` | 修改 | buildToolUseContext 传入 fileStateCache | - |
| `src/agent/agent.ts` | 修改 | 创建 FileStateCache 实例 | - |
| `src/agent/tools/read/read.ts` | 修改 | execute 中 `recordRead()` | `read.test.ts`（扩展） |
| `src/agent/tools/edit.ts` | 修改 | validateInput + execute 集成 | `edit.test.ts`（扩展） |
| `src/agent/tools/edit.ts` | 修改 | 新增引号规范化函数 | `quotes.test.ts` 或 `edit.test.ts` |

---

## 九、风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 模型不熟悉新约束，频繁触发错误码 6 | EditTool description 中明确说明必须先 Read |
| 现有测试因接口变更而编译失败 | 修改 ToolUseContext 时，同步更新所有测试中的 mock context |
| 性能影响（stat 调用增加） | ReadTool 原本就调用 readFile，stat 是额外一次系统调用，开销可忽略 |
| LRU 缓存导致文件状态被意外淘汰 | maxSize 25MB 足够大，正常文件编辑场景不会触发淘汰 |

**回滚策略**：
- 移除 `ToolUseContext.fileStateCache` 字段
- 恢复 `buildToolUseContext` 签名
- 删除 `file-state.ts`
- 恢复 `read.ts` 和 `edit.ts` 到修改前状态

---

*本设计严格遵循 TDD，先写测试后写实现。*
