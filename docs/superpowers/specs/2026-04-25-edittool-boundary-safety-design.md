# WriteTool 安全补齐与 EditTool 边界测试完善

> 日期：2026-04-25
> 范围：WriteTool 安全补齐、文件大小限制、脏写集成测试、WriteTool 单元测试

---

## 目标

补齐当前 EditTool 体系的安全缺口和测试缺口：

1. WriteTool 没有先读后写检查（description 声称会失败，实际不会）
2. WriteTool 没有脏写检测
3. 脏写检测（errorCode 7）无集成测试覆盖
4. 无文件大小限制，大文件可能导致 OOM

---

## 架构

本次改动涉及 4 个模块，互不阻塞：

| 模块 | 目标文件 | 说明 |
|------|---------|------|
| WriteTool 安全补齐 | `src/agent/tools/write.ts` | 新增 `validateInput`，增加脏写检测，写入后更新缓存 |
| 文件大小限制 | `src/agent/tools/file-guard.ts`（新建） | 共用工具函数，EditTool / WriteTool 读取前检查 |
| 脏写集成测试 | `src/agent/tools/edit.test.ts` | 模拟 mtime 变化触发 errorCode 7 |
| WriteTool 测试 | `src/agent/tools/write.test.ts`（新建） | 创建/覆盖/拒绝/脏写场景的完整覆盖 |

依赖关系：WriteTool 检查 → 文件大小限制 → 测试覆盖。脏写测试可并行。

---

## WriteTool 安全补齐

### validateInput

```typescript
validateInput: async (params, context) => {
  const fullPath = resolve(cwd, params.file_path);

  // 检查文件是否存在
  let exists: boolean;
  try {
    await stat(fullPath);
    exists = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      exists = false;
    } else {
      throw e;
    }
  }

  // 文件不存在 → 允许创建（无需先读取）
  if (!exists) {
    return { ok: true };
  }

  // 文件存在 → 要求已通过 ReadTool 读取
  const readCheck = context.fileStateCache.canEdit(fullPath);
  if (!readCheck.ok) {
    return {
      ok: false,
      message: readCheck.reason,
      errorCode: readCheck.errorCode, // 6
    };
  }

  // 脏写检测第一层
  const stats = await stat(fullPath);
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

  return { ok: true };
}
```

### execute（修改）

在写入前增加二次脏写检测（同 EditTool 模式），写入后更新 `fileStateCache`：

```typescript
// 写入后更新缓存
const newStats = await stat(fullPath);
context.fileStateCache.recordEdit(fullPath, params.content, Math.floor(newStats.mtimeMs));
```

**决策依据：** 参考 cc FileWriteTool 实现。cc 在 WriteTool 中也做了双层脏写检测和缓存更新。

---

## 文件大小限制

### 新建 `src/agent/tools/file-guard.ts`

```typescript
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

export async function checkFileSize(
  filePath: string,
  maxBytes = MAX_FILE_SIZE_BYTES
): Promise<void> {
  const stats = await stat(filePath).catch(() => null);
  if (stats && stats.size > maxBytes) {
    throw new Error(
      `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). ` +
        `Maximum allowed: ${(maxBytes / 1024 / 1024).toFixed(0)}MB.`
    );
  }
}
```

### 接入点

- **EditTool validateInput**：在 `readFile(fullPath, "utf-8")` 之前调用
- **WriteTool execute**：在 `readFile(fullPath, "utf-8")` 之前调用（用于获取 originalFile）

**为什么是 1GB：** 远超任何正常源代码文件，但能在读取日志/核心转储前阻止 OOM。cc 无显式限制，靠系统内存边界。

---

## 脏写检测集成测试

### 测试策略

当前 22 个测试均未触及 `errorCode 7`。使用 `fs.utimes` 主动将文件 mtime 推到未来，确保触发检测：

```typescript
test('文件修改后编辑应触发脏写检测', async () => {
  // 1. 创建临时文件并 Read
  // 2. 修改文件内容
  // 3. fs.utimes(filePath, Date.now() / 1000 + 1, Date.now() / 1000 + 1)
  // 4. Edit 同一文件
  // 5. 验证返回 errorCode 7
});
```

### 覆盖场景

| 测试名 | 检测层 | 触发方式 |
|--------|--------|---------|
| mtime 变化触发 validateInput 拒绝 | 第一层 | utimes + mtime > timestamp |
| mtime 变化但内容未变（全量读取） | 第一层 | utimes + content 相同 → 通过 |
| mtime 变化触发 execute 抛异常 | 第二层 | utimes + 内容变化 |

---

## WriteTool 单元测试

### 新建 `src/agent/tools/write.test.ts`

| 测试名 | 场景 | 期望结果 |
|--------|------|---------|
| 创建新文件 | 文件不存在 | type: "create"，写入内容 |
| 覆盖已有文件（未读取） | 文件存在，cache 无记录 | errorCode: 6 |
| 覆盖已有文件（已读取） | Read → Write | type: "update"，originalFile 正确 |
| 连续写入无需重新读取 | Read → Write → Write | 第二次通过 |
| 脏写检测（validateInput） | Read → 修改 → Write | errorCode: 7 |

---

## 错误码体系

复用现有错误码，保持一致：

| 错误码 | 含义 | 触发工具 |
|--------|------|---------|
| 6 | 文件未读取 | EditTool, WriteTool |
| 7 | 文件已修改 | EditTool, WriteTool |

---

## 范围外（不实现）

- settings 文件特殊校验：settings 文件范围尚不明确，需要单独设计
- LSP 通知：ys-code 当前无 LSP 集成
- 文件历史备份：依赖 git 做版本控制
