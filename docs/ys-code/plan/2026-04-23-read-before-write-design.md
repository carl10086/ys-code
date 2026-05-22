# Read-before-Write 机制设计文档

> 目标：为 ys-code 的 EditTool 引入"强制先读后写"安全机制
> 方案：B（轻量级 FileReadTracker，工厂参数注入）
> 日期：2026-04-23

---

## 一、设计概述

### 1.1 问题定义

当前 ys-code 的 `EditTool` 允许模型在**未读取文件**的情况下直接编辑，存在以下风险：
- 模型基于过时记忆编辑文件，导致意外覆盖
- 外部程序（编辑器、linter、git）在读取后修改了文件，EditTool 直接覆盖导致变更丢失
- 无法区分"全量读取"和"部分读取"，部分读取的文件不适合直接编辑

### 1.2 核心思路

借鉴 claude-code-haha 的 `readFileState` 机制，但**不引入 `lru-cache` 依赖，不修改 `ToolUseContext`**。

改为：
1. 新建 `src/agent/file-state.ts`，提供轻量级 `FileReadTracker`
2. `session.ts` 创建 tracker 实例，通过工厂函数参数注入到 ReadTool 和 EditTool
3. ReadTool 成功读取后调用 `tracker.recordRead()`
4. EditTool 编辑前调用 `tracker.canEdit()` 检查

### 1.3 设计原则

- **最小侵入**：只新增 1 个文件，修改 3 个现有文件
- **可扩展**：数据结构预留 `timestamp` 字段，后续加"防脏写"只需改 tracker 内部
- **可测试**：tracker 是纯逻辑对象，无文件系统依赖，可完全 mock

---

## 二、数据结构

### 2.1 FileReadRecord

```typescript
// file-state.ts

/**
 * 文件读取记录
 * 每次成功调用 ReadTool 后生成，供 EditTool 校验使用
 */
interface FileReadRecord {
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

### 2.2 FileReadTracker

```typescript
// file-state.ts

export class FileReadTracker {
  /** 内部存储：路径 -> 读取记录 */
  private reads = new Map<string, FileReadRecord>();

  /**
   * 记录一次文件读取
   * @param path 规范化后的绝对路径
   * @param content 读取到的内容
   * @param timestamp 文件修改时间（mtimeMs）
   * @param offset 部分读取起始行（可选）
   * @param limit 部分读取行数（可选）
   * @param isPartialView 是否为部分视图（可选，默认 false）
   */
  recordRead(
    path: string,
    content: string,
    timestamp: number,
    offset?: number,
    limit?: number,
    isPartialView?: boolean,
  ): void {
    this.reads.set(path, {
      content,
      timestamp,
      offset,
      limit,
      isPartialView: isPartialView ?? false,
    });
  }

  /**
   * 检查文件是否可以编辑
   * @param path 规范化后的绝对路径
   * @returns 检查结果
   */
  canEdit(path: string):
    | { ok: true; record: FileReadRecord }
    | { ok: false; reason: string; errorCode: number } {
    const record = this.reads.get(path);

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
   * EditTool 成功执行后调用，更新缓存中的内容和时间戳
   */
  recordEdit(path: string, newContent: string, newTimestamp: number): void {
    this.reads.set(path, {
      content: newContent,
      timestamp: newTimestamp,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
  }

  /** 清除记录（用于测试或会话重置） */
  clear(): void {
    this.reads.clear();
  }

  /** 获取记录（调试用） */
  get(path: string): FileReadRecord | undefined {
    return this.reads.get(path);
  }
}
```

---

## 三、接口契约

### 3.1 ReadTool 侧契约

ReadTool 在**成功读取文件后**必须调用 `tracker.recordRead()`。

调用时机：**execute 函数返回结果之前**。

```typescript
// read.ts 中 execute 的伪代码

async execute(_toolCallId: string, params: ReadInput): Promise<ReadOutput> {
  const fullPath = expandPath(params.file_path, cwd);
  const ext = extname(fullPath).toLowerCase().slice(1);
  const offset = params.offset ?? 1;

  // 1. 读取文件
  const result = await readFileByType(fullPath, ext, offset, params.limit, ...);

  // 2. 【新增】记录读取状态
  const stats = await stat(fullPath);
  tracker.recordRead(
    fullPath,
    result.file.content ?? '',  // 实际读取到的内容
    Math.floor(stats.mtimeMs),  // 文件修改时间
    params.offset,              // 部分读取起始行
    params.limit,               // 部分读取行数
  );

  // 3. 返回结果
  return result;
}
```

**注意**：
- 只有**成功读取**才记录。如果读取失败（文件不存在、权限不足等），不记录。
- 图片、PDF 等非文本内容的读取，也记录（`content` 为空字符串或 base64 摘要）。
- Notebook 读取记录的是解析后的 JSON 内容。

### 3.2 EditTool 侧契约

EditTool 在 `validateInput` 中调用 `tracker.canEdit()`，在 `execute` 成功后调用 `tracker.recordEdit()`。

```typescript
// edit.ts 中 validateInput 的伪代码

validateInput: async (params: EditInput) => {
  const fullPath = resolve(cwd, params.file_path);

  // 1. 【新增】检查是否已读取
  const readCheck = tracker.canEdit(fullPath);
  if (!readCheck.ok) {
    return {
      ok: false,
      message: readCheck.reason,
      errorCode: readCheck.errorCode,
    };
  }

  // 2. 原有校验逻辑...
  if (params.old_string === params.new_string) {
    return { ok: false, message: '...', errorCode: 1 };
  }

  // 3. 文件存在性检查...
  // ...

  return { ok: true };
},
```

```typescript
// edit.ts 中 execute 的伪代码

async execute(_toolCallId, params, _context) {
  const fullPath = resolve(cwd, params.file_path);
  // ... 执行编辑 ...

  // 【新增】更新 tracker
  const stats = await stat(fullPath);
  tracker.recordEdit(fullPath, newContent, Math.floor(stats.mtimeMs));

  return { filePath: fullPath, oldString, newString, originalFile, replaceAll };
}
```

### 3.3 WriteTool 侧契约（可选）

WriteTool（写新文件）也需要检查，防止覆盖已有文件：

```typescript
// write.ts 中 validateInput 的伪代码

validateInput: async (params: WriteInput) => {
  const fullPath = resolve(cwd, params.file_path);

  // 【新增】如果要覆盖已有文件，要求先读取
  if (await fileExists(fullPath)) {
    const readCheck = tracker.canEdit(fullPath);
    if (!readCheck.ok) {
      return {
        ok: false,
        message: readCheck.reason,
        errorCode: readCheck.errorCode,
      };
    }
  }

  // ... 原有校验 ...
}
```

> **注**：WriteTool 的覆盖检查作为可选扩展，不在本次实现范围内，但 tracker 的设计支持此扩展。

---

## 四、与现有代码的集成点

### 4.1 修改文件清单

| 文件 | 修改内容 | 影响范围 |
|------|---------|---------|
| `src/agent/file-state.ts` | **新增**，FileReadTracker 实现 | 无影响 |
| `src/agent/tools/read/read.ts` | execute 中增加 `tracker.recordRead()` 调用 | ReadTool |
| `src/agent/tools/edit.ts` | validateInput 中增加 `tracker.canEdit()` 检查；execute 中增加 `tracker.recordEdit()` | EditTool |
| `src/agent/session.ts` | 创建 tracker 实例，传入 ReadTool 和 EditTool 工厂函数 | Session 初始化 |

### 4.2 session.ts 集成伪代码

```typescript
// session.ts

import { FileReadTracker } from './file-state.js';  // 【新增】

constructor(options: AgentSessionOptions) {
  this.cwd = options.cwd;

  // 【新增】创建 tracker
  const fileReadTracker = new FileReadTracker();

  const tools = options.tools ?? [
    createReadTool(options.cwd, fileReadTracker),   // 【修改】注入 tracker
    createWriteTool(options.cwd),
    createEditTool(options.cwd, fileReadTracker),   // 【修改】注入 tracker
    createBashTool(options.cwd),
    createGlobTool(options.cwd),
  ];

  this.agent = new Agent({
    // ...
    tools,
  });
}
```

### 4.3 ReadTool 工厂签名修改

```typescript
// read.ts

export function createReadTool(
  cwd: string,
  tracker: FileReadTracker,  // 【新增】
): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    // ... 原有配置 ...

    execute: async (_toolCallId: string, params: ReadInput): Promise<ReadOutput> => {
      const fullPath = expandPath(params.file_path, cwd);
      // ... 读取逻辑 ...

      // 【新增】记录读取
      const stats = await stat(fullPath);
      tracker.recordRead(
        fullPath,
        result.file.content ?? '',
        Math.floor(stats.mtimeMs),
        params.offset,
        params.limit,
      );

      return result;
    },
  });
}
```

### 4.4 EditTool 工厂签名修改

```typescript
// edit.ts

export function createEditTool(
  cwd: string,
  tracker: FileReadTracker,  // 【新增】
): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    // ... 原有配置 ...

    validateInput: async (params: EditInput) => {
      const fullPath = resolve(cwd, params.file_path);

      // 【新增】先读后写检查
      const readCheck = tracker.canEdit(fullPath);
      if (!readCheck.ok) {
        return {
          ok: false,
          message: readCheck.reason,
          errorCode: readCheck.errorCode,
        };
      }

      // ... 原有校验逻辑 ...
    },

    async execute(_toolCallId, params, _context) {
      // ... 执行编辑 ...
      await writeFile(fullPath, newContent, 'utf-8');

      // 【新增】更新 tracker
      const stats = await stat(fullPath);
      tracker.recordEdit(fullPath, newContent, Math.floor(stats.mtimeMs));

      return { filePath: fullPath, oldString, newString, originalFile, replaceAll };
    },
  });
}
```

---

## 五、错误处理

### 5.1 错误码定义

沿用 cc 的错误码体系，避免冲突：

| 错误码 | 场景 | 消息示例 |
|--------|------|---------|
| 6 | 文件未读取 | "File has not been read yet. Read it first before writing to it." |
| 6 | 部分视图 | "File has only been partially read. Read the full file before writing to it." |

> 注：当前 ys-code 的 EditTool 已有错误码 1（无变化）、3（文件已存在）、4（文件不存在）、8（字符串未找到）、9（多匹配）。新增错误码 6 不与现有冲突。

### 5.2 错误恢复路径

当 EditTool 返回错误码 6 时，模型会收到错误消息，正确的恢复路径是：

1. 模型调用 `Read` 工具读取该文件
2. ReadTool 成功读取后，`tracker.recordRead()` 写入记录
3. 模型再次调用 `Edit` 工具，此次 `tracker.canEdit()` 通过

### 5.3 边界情况

| 场景 | 行为 |
|------|------|
| 读取文件后，模型尝试编辑不存在的文件 | `canEdit` 通过（已读取），但后续文件存在性检查失败，返回错误码 4 |
| 编辑成功后立即再次编辑同一文件 | `canEdit` 通过（execute 中已更新 tracker） |
| 读取文件 A，编辑文件 B | `canEdit` 失败（B 未被读取） |
| 部分读取（offset/limit 有值）后编辑 | `canEdit` 失败（部分读取不允许编辑） |
| 会话恢复后编辑之前读取过的文件 | `canEdit` 失败（tracker 未持久化，会话重启后清空） |

---

## 六、测试策略

### 6.1 FileReadTracker 单元测试

```typescript
// file-state.test.ts

describe('FileReadTracker', () => {
  it('should allow edit after full read', () => {
    const tracker = new FileReadTracker();
    tracker.recordRead('/foo.ts', 'content', 1000);
    const result = tracker.canEdit('/foo.ts');
    expect(result.ok).toBe(true);
  });

  it('should reject edit if file not read', () => {
    const tracker = new FileReadTracker();
    const result = tracker.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(6);
  });

  it('should reject edit if partial view', () => {
    const tracker = new FileReadTracker();
    tracker.recordRead('/foo.ts', 'content', 1000, 1, 10, true);
    const result = tracker.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
  });

  it('should update record after edit', () => {
    const tracker = new FileReadTracker();
    tracker.recordRead('/foo.ts', 'old', 1000);
    tracker.recordEdit('/foo.ts', 'new', 2000);
    const record = tracker.get('/foo.ts');
    expect(record?.content).toBe('new');
    expect(record?.timestamp).toBe(2000);
  });
});
```

### 6.2 EditTool 集成测试

```typescript
// edit.test.ts（扩展）

it('should reject edit without prior read', async () => {
  const tracker = new FileReadTracker();
  const tool = createEditTool('/tmp', tracker);
  const result = await tool.validateInput!({
    file_path: '/tmp/foo.ts',
    old_string: 'a',
    new_string: 'b',
  }, {} as ToolUseContext);
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe(6);
});

it('should allow edit after read', async () => {
  const tracker = new FileReadTracker();
  tracker.recordRead('/tmp/foo.ts', 'abc', Date.now());
  const tool = createEditTool('/tmp', tracker);
  const result = await tool.validateInput!({
    file_path: '/tmp/foo.ts',
    old_string: 'a',
    new_string: 'b',
  }, {} as ToolUseContext);
  expect(result.ok).toBe(true);
});
```

---

## 七、未来扩展预留

### 7.1 防脏写（Phase 2）

在 `FileReadTracker.canEdit()` 中增加时间戳对比：

```typescript
canEdit(path: string, currentMtime?: number): ... {
  const record = this.reads.get(path);
  // ... 现有检查 ...

  // 【未来扩展】时间戳检查
  if (currentMtime !== undefined && currentMtime > record.timestamp) {
    // 进一步对比内容，防止误报
    const currentContent = await readFile(path, 'utf-8');
    if (currentContent !== record.content) {
      return {
        ok: false,
        reason: 'File has been modified since read. Read it again before writing.',
        errorCode: 7,
      };
    }
  }
}
```

### 7.2 持久化（Phase 3）

如果需要会话恢复后保留读取记录，可在 `session.ts` 中将 tracker 序列化到 SessionManager：

```typescript
// 会话保存时
sessionManager.saveReadState(tracker.dump());

// 会话恢复时
const dump = sessionManager.restoreReadState();
tracker.load(dump);
```

### 7.3 子 Agent 共享（Phase 3）

如果需要子 Agent 继承父 Agent 的读取记录，可在 fork 时克隆 tracker：

```typescript
const childTracker = new FileReadTracker();
for (const [path, record] of parentTracker.entries()) {
  childTracker.recordRead(path, record.content, record.timestamp, ...);
}
```

---

## 八、风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 模型不熟悉新约束，频繁触发"未读取"错误 | 在 EditTool 的 description 中明确说明必须先 Read |
| 现有测试因缺少 tracker 参数而编译失败 | 修改工厂签名时，同步更新所有调用点 |
| 性能影响（stat 调用增加） | ReadTool 原本就调用 readFile，stat 是额外的一次系统调用，开销可忽略 |
| 多会话并发时 tracker 状态混乱 | 当前 ys-code 为单会话模式，无此问题；未来多会话时需改为 ToolUseContext 方案 |

**回滚策略**：若发现问题，只需恢复 `edit.ts` 和 `read.ts` 的工厂签名（去掉 tracker 参数），删除 `file-state.ts`，即可完全回滚。

---

## 九、实现 checklist

- [ ] 新建 `src/agent/file-state.ts`（FileReadTracker + FileReadRecord + 单元测试）
- [ ] 修改 `src/agent/tools/read/read.ts`（工厂签名 + execute 中 recordRead）
- [ ] 修改 `src/agent/tools/edit.ts`（工厂签名 + validateInput 中 canEdit + execute 中 recordEdit）
- [ ] 修改 `src/agent/session.ts`（创建 tracker 并注入工厂函数）
- [ ] 更新 `src/agent/tools/index.ts`（如有类型导出需要）
- [ ] 扩展 `edit.test.ts`（集成测试）
- [ ] 更新 EditTool 的 description（告知模型必须先 Read）
