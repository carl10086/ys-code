# 先读后写（Read-before-Write）

> 分析对象：src/agent/file-state.ts @ da24438, src/agent/tools/edit.ts @ da24438

---

## 问题定义

模型在**未读取文件**的情况下直接发起编辑，可能导致：
- 基于过时记忆编辑文件，造成意外覆盖
- 编辑了错误的文件区域
- 无法感知文件已被外部修改

## 核心设计：读取凭证

FileStateCache 不是"缓存"，是**读取凭证 + 状态快照**。它存储的不是"文件内容"，而是"模型在某一刻看到的文件状态"。

```typescript
export interface FileReadRecord {
  content: string;      // 读取时的文件内容
  timestamp: number;    // 读取时的 mtime
  offset?: number;      // 部分读取起始行
  limit?: number;       // 部分读取行数
  isPartialView?: boolean;  // 是否为加工后的视图
}
```

## canEdit() 的三种返回状态

```typescript
canEdit(path: string):
  | { ok: true; record: FileReadRecord }
  | { ok: false; reason: string; errorCode: number }
```

| 状态 | 条件 | 错误码 | 恢复路径 |
|------|------|--------|---------|
| ok: true | 文件已全量读取 | - | 继续校验 |
| ok: false | 文件未读取 | 6 | 调用 ReadTool 读取 |
| ok: false | 部分读取 | 6 | 调用 ReadTool 全量读取 |

## 部分读取拒绝的理由

以下三种情况都视为"部分读取"，不允许编辑：

1. `isPartialView === true`：模型看到的是加工后的内容（如 CLAUDE.md 截断版）
2. `offset !== undefined`：只读取了文件的某一行之后的内容
3. `limit !== undefined`：只读取了限定行数

```typescript
if (record.isPartialView || record.offset !== undefined || record.limit !== undefined) {
  return { ok: false, reason: "File has only been partially read...", errorCode: 6 };
}
```

## 为什么不能用 Set<string> 记录"读过哪些文件"

如果只存 `Set<string>`：
- 不知道文件读取后是否被外部修改
- 不知道读取的是全量还是部分
- 不知道读取时的具体内容是什么

FileStateCache 存储的 `content` + `timestamp` 使得**脏写检测**成为可能。

## 错误恢复路径

当 EditTool 返回错误码 6 时，模型的正确恢复路径：
1. 调用 ReadTool 读取该文件（全量）
2. ReadTool 的 `execute` 中调用 `recordRead()`
3. 再次调用 EditTool，`canEdit()` 通过
