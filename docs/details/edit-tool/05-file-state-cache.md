# FileStateCache

> 分析对象：src/agent/file-state.ts @ da24438

---

## 概述

FileStateCache 是基于 LRUCache 的文件读取状态管理器。它存储的不是"文件缓存"，而是**读取凭证 + 状态快照**，用于：
1. 强制先读后写（Read-before-Write）
2. 脏写检测（Dirty-write Detection）
3. 编辑后可持续编辑（无需重新读取）

## 数据结构

### FileReadRecord

```typescript
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

| 字段 | 作用 | 缺失后果 |
|------|------|---------|
| content | 内容回退对比 | Windows 云同步改 mtime 误报；编辑后可持续编辑 |
| timestamp | 脏写检测基准 | 不知道"读取后文件是否被改过" |
| offset/limit | 区分部分/全量读取 | 部分读取后 mtime 变了，不知该放行还是拦截 |
| isPartialView | 拒绝加工后的内容 | 模型看到截断版也允许编辑，危险 |

## LRU 策略

```typescript
constructor(options?: { maxEntries?: number; maxSizeBytes?: number }) {
  this.cache = new LRUCache<string, FileReadRecord>({
    max: options?.maxEntries ?? 100,           // 最多 100 个文件
    maxSize: options?.maxSizeBytes ?? 25 * 1024 * 1024,  // 最多 25MB
    sizeCalculation: (value) => Math.max(1, Buffer.byteLength(value.content)),
  });
}
```

- **maxEntries**：按条目数限制，防止路径爆炸
- **maxSizeBytes**：按内容字节数限制，防止大文件撑爆内存
- **sizeCalculation**：以 `content` 的字节数计算每条记录的"大小"

## 接口方法

### recordRead

```typescript
recordRead(path, content, timestamp, offset?, limit?, isPartialView?): void
```

- 规范化路径（`normalize(path)`）
- `isPartialView` 默认 `false`
- 覆盖同一文件的旧记录

### canEdit

```typescript
canEdit(path):
  | { ok: true; record: FileReadRecord }
  | { ok: false; reason: string; errorCode: number }
```

- 检查文件是否已读取
- 检查是否为部分读取（`isPartialView || offset !== undefined || limit !== undefined`）
- 错误码统一为 `6`

### recordEdit

```typescript
recordEdit(path, newContent, newTimestamp): void
```

- 编辑成功后调用
- `offset` 和 `limit` 清空为 `undefined`
- `isPartialView` 强制为 `false`
- 这意味着刚编辑完的文件**不需要重新 Read** 就能再次 Edit

### get / clear

```typescript
get(path): FileReadRecord | undefined
clear(): void
```

## 为什么用 LRU 而不是 Map

| 特性 | Map | LRUCache |
|------|-----|----------|
| 内存保护 | 无，无限增长 | 有，按条目数 + 大小限制 |
| 淘汰策略 | 无 | 最近最少使用 |
| 大小计算 | 无 | 自定义 sizeCalculation |
| 并发安全 | 单线程安全 | 单线程安全 |

**结论**：Map 在长时间运行的 Agent 会话中可能导致内存泄漏（读取大量文件后）。LRU 自动淘汰旧记录，适合 Agent 场景。

## 与 cc 的对比

c 的 `FileStateCache` 同样基于 LRUCache，参数一致（100 条目 / 25MB）。ys-code 的设计直接复用了这一策略，但实现更轻量（无 dump/load 持久化接口）。
