# Claude Code vs Pi-mono 持久化机制对比分析

> 创建时间: 2026-04-21
> 用途: 为 ys-code 引入 compact 机制前的持久化层调研
> 分析基于: claude-code-haha (refer/) 和 pi-mono (refer/) 的源代码

---

## 1. 概述

持久化层是上下文压缩(compact)的基础设施。两个系统都使用 **JSONL** 格式存储会话，但在数据结构、加载策略和与 compact 的集成方式上有显著差异。

---

## 2. Claude Code 持久化机制

### 2.1 存储格式

```
~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl
```

每行一个 entry，核心类型:

| Entry 类型 | 说明 |
|-----------|------|
| `user` / `assistant` / `attachment` / `system` | 对话消息 |
| `compact_boundary` | 压缩边界标记（system 子类型） |
| `attribution-snapshot` | 归因快照（数据量大） |
| `custom-title` / `ai-title` / `task-summary` | 会话元数据 |

### 2.2 消息链结构

通过 `parentUuid` 字段链接成**链式结构**，支持分支（类似链表）。

```json
{"type":"user","uuid":"msg-1","content":"Hello"}
{"type":"assistant","uuid":"msg-2","parentUuid":"msg-1","content":"Hi"}
```

### 2.3 写入方式

简单的 `appendFileSync` 追加，无事务:

```typescript
function appendEntryToFile(fullPath: string, entry: Record<string, unknown>): void {
  const line = jsonStringify(entry) + '\n';
  fs.appendFileSync(fullPath, line, { mode: 0o600 });
}
```

### 2.4 读取策略（核心差异点）

CC 为了处理超大文件（几十 MB 甚至 GB）做了**分块截断优化**:

```
文件大小 < 5MB:
  → 直接 readFile 全量读取

文件大小 > 5MB:
  → 分块向前扫描 (1MB chunks)
  → 遇到 compact_boundary:
      - 无 preservedSegment: 截断 accumulator，丢弃之前所有内容
      - 有 preservedSegment: 保留标记，继续扫描
  → attribution-snapshot 在 fd 级别直接跳过（不进入内存）
  → 截断后还需扫描 boundary 前的元数据（metadataLines 恢复）
```

**关键代码路径:**
- `readTranscriptForLoad()` — 分块扫描主入口
- `processStraddle()` / `scanChunkLines()` — 块内行处理
- `loadTranscriptFile()` — 组装最终消息链

### 2.5 与 Compact 的集成

- `compact_boundary` 是 `system` 类型消息，携带 `compactMetadata`
- `compactMetadata.preservedSegment` 指示是否保留边界附近消息
- 加载时自动丢弃 boundary 之前的内容，实现"压缩即截断"
- 连续 compact 会形成多个 boundary，每次加载只保留最后一个 boundary 之后的内容

---

## 3. Pi-mono 持久化机制

### 3.1 存储格式

```
~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl
```

每行一个 entry，核心类型:

| Entry 类型 | 说明 |
|-----------|------|
| `session` | 文件头（版本、id、cwd、时间戳） |
| `message` | 包装后的 AgentMessage |
| `compaction` | 压缩摘要，带 `firstKeptEntryId` |
| `branch_summary` | 分支切换时的上下文摘要 |
| `model_change` / `thinking_level_change` | 配置变更 |
| `custom` / `label` / `session_info` | 扩展和元数据 |

### 3.2 树结构

每个 entry 有 `id`（8位 hex）和 `parentId`，形成**显式树**:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
{"type":"message","id":"a1b2c3d4","parentId":null,"message":{"role":"user","content":"Hello"}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","message":{"role":"assistant","content":"Hi"}}
```

### 3.3 写入方式

- 首次有 assistant 消息时: 批量写入所有已有 entry
- 之后: 逐条追加
- 版本迁移时会 `_rewriteFile()` 全量重写

```typescript
_persist(entry: SessionEntry): void {
  if (!hasAssistant) {
    this.flushed = false; // 延迟到 assistant 出现时批量写入
    return;
  }
  if (!this.flushed) {
    // 批量写入所有已有 entry
    for (const e of this.fileEntries) { appendFileSync(...); }
    this.flushed = true;
  } else {
    appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
  }
}
```

### 3.4 Context 构建（内存中完成）

```typescript
buildSessionContext(entries, leafId, byId): SessionContext {
  // 1. 从 leaf 走回 root，收集路径
  const path = walkFromLeafToRoot(leafId);

  // 2. 如果遇到 compaction entry:
  if (compaction) {
    // 先插入 summary（作为 user 消息）
    messages.push(createCompactionSummaryMessage(compaction.summary, ...));

    // 再插入 firstKeptEntryId 到 compaction 之间的消息
    for (entry from firstKeptEntryId to compaction) { appendMessage(entry); }

    // 再插入 compaction 之后的消息
    for (entry after compaction) { appendMessage(entry); }
  }

  return { messages, thinkingLevel, model };
}
```

**特点**: 全量加载文件到内存，构建 context 时动态处理 compaction。

### 3.5 版本迁移

自动升级机制:
- **v1 → v2**: 添加 id/parentId 树结构，将 `firstKeptEntryIndex` 转为 `firstKeptEntryId`
- **v2 → v3**: `hookMessage` role 重命名为 `custom`

---

## 4. 关键差异对比

| 维度 | Claude Code | Pi-mono |
|------|-------------|---------|
| **数据模型** | 链式（parentUuid） | 树形（id/parentId） |
| **压缩标记** | `compact_boundary` system 消息 | `compaction` entry |
| **加载策略** | 文件级截断（boundary 前直接丢弃） | 全量加载，内存中构建 context |
| **读取优化** | 分块扫描、fd 级跳过 attr-snap | 无特殊优化，简单 `readFile` |
| **分支支持** | 通过 parentUuid 链隐含支持 | 显式树结构 + `branch()` API |
| **元数据存储** | 分散在各种 entry 中 | 集中在 header 和专用 entry |
| **版本迁移** | 无（无 session header） | 显式版本号 + 自动迁移 |
| **代码复杂度** | 高（边界处理、metadata 恢复、分块扫描） | 低（纯内存构建） |
| **适用场景** | 超大文件（几十 MB ~ GB） | 中小型会话（几 MB 以内） |

---

## 5. 对 ys-code 的启示

### 5.1 当前 ys-code 现状

- 消息纯内存存储（`Agent._state.messages: AgentMessage[]`）
- 无持久化、无会话恢复、无 compact
- AgentSession 通过 `sessionId` 标识会话，但不保存到磁盘

### 5.2 选型建议

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| 先跑通 MVP（< 1000 条消息/会话） | **Pi-mono 风格** | 简单直接，compact 集成清晰，代码量少 |
| 预期超长会话（> 5000 条/几十 MB） | **CC 风格** | 分块截断避免加载时间和内存爆炸 |
| 需要分支/树导航 | **Pi-mono 风格** | 树结构天然支持 `/tree` 分支 |

### 5.3 推荐的渐进路径

```
Phase 1: Pi-mono 风格持久化（JSONL + 树 + 内存构建）
  ↓
Phase 2: 基于持久化的 Compact（自动/手动触发）
  ↓
Phase 3: 如果会话文件变大，引入 CC 风格的分块截断读取
```

**Phase 1 核心工作量**:
1. 定义 `SessionEntry` 类型体系（header + message + compaction + ...）
2. 实现 `SessionManager` 类（加载/追加/构建 context）
3. 将 `AgentSession` 的消息存储从内存数组改为 `SessionManager`
4. 添加 `--resume` 或自动恢复最近会话的能力

**Phase 2 核心工作量**:
1. Token 估算函数
2. 压缩触发判断（阈值计算）
3. 摘要生成（调用 LLM）
4. `CompactionEntry` 写入 + `buildSessionContext` 处理 compaction

---

## 6. 相关源码文件

### Claude Code
- `refer/claude-code-haha/src/utils/sessionStorage.ts` — 主存储逻辑
- `refer/claude-code-haha/src/utils/sessionStoragePortable.ts` — 纯 Node.js 共享工具（分块读取、JSON 字段提取）
- `refer/claude-code-haha/src/services/compact/compact.ts` — compact 与 storage 的交互

### Pi-mono
- `refer/pi-mono/packages/coding-agent/src/core/session-manager.ts` — SessionManager 实现
- `refer/pi-mono/packages/coding-agent/docs/session.md` — 会话文件格式文档
- `refer/pi-mono/packages/coding-agent/src/core/compaction/` — compact 系统
