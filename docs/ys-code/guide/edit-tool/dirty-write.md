# 脏写检测

> 分析对象：src/agent/tools/edit.ts @ da24438

---

## 问题定义

在 ReadTool 读取文件后、EditTool 写入文件前，文件可能被外部程序修改：
- 用户在 Vim/VSCode 中手动编辑
- linter 或 formatter 自动修改
- git 操作（如切换分支）

如果 EditTool 直接覆盖，这些外部修改将丢失。

## 双层检测架构

c 的设计哲学：`validateInput` 到 `execute` 之间可能存在**用户确认间隙**（几秒到几十秒），因此需要两次检测。

### 第一层：validateInput

```typescript
const stats = await stat(fullPath).catch(() => null);
if (stats && readCheck.record) {
  const currentMtime = Math.floor(stats.mtimeMs);
  if (currentMtime > readCheck.record.timestamp) {
    // mtime 变了！
    const isFullRead = readCheck.record.offset === undefined && readCheck.record.limit === undefined;
    if (!isFullRead) {
      // 部分读取无法对比内容，直接拒绝
      return { ok: false, message: "File has been modified...", errorCode: 7 };
    }
    const content = await readFile(fullPath, 'utf-8').catch(() => null);
    if (content !== readCheck.record.content) {
      // 内容确实变了
      return { ok: false, message: "File has been modified...", errorCode: 7 };
    }
    // 内容没变，是误报（Windows 云同步等只改 mtime）
  }
}
```

**策略**：先比 mtime（快），mtime 没变则安全；mtime 变了再比 content（慢但准确）。

### 第二层：execute

```typescript
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
```

**关键区别**：第二层在真正写入前执行，使用**已经读取到的 content**（而非重新读取），避免异步操作被插入。

## 全量读取 vs 部分读取

| 场景 | 策略 | 原因 |
|------|------|------|
| 全量读取 | mtime 变了对比 content | 有完整内容可做回退对比 |
| 部分读取 | mtime 变了直接拒绝 | 不知道文件其余部分是否被修改 |

## 误报处理

某些场景下 mtime 会变但 content 不变：
- Windows 云同步工具（OneDrive、Dropbox）
- 杀毒软件扫描后重置时间戳
- `touch` 命令

全量读取时通过 content 对比排除误报；部分读取时保守拒绝。
