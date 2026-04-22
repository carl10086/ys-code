# Persistence-Compact 后续问题跟踪

> **状态:** 代码审查后剩余问题  
> **创建日期:** 2026-04-22  
> **关联计划:** `docs/superpowers/plans/2026-04-21-persistence-compact-plan.md`

---

## 问题清单

| 编号 | 问题 | 优先级 | 影响范围 | 预计工作量 |
|------|------|--------|----------|-----------|
| ISSUE-1 | Compact 摘要质量仅为占位级 | P1 | 上下文压缩效果 | 中等 |
| ISSUE-2 | SessionStorage 缺少文件锁 | P1 | 数据完整性 | 小 |
| ISSUE-3 | findActiveBranch 叶子节点选择策略 | P2 | 多分支恢复 | 小 |
| ISSUE-4 | findLatestSessionFile 不区分 cwd | P2 | 跨项目恢复 | 小 |
| ISSUE-5 | AgentMessage 类型系统不完整 | P3 | 类型安全 | 中等 |

---

## ISSUE-1: Compact 摘要质量仅为占位级

### 问题描述

`CompactTrigger.createCompactBoundary()` 当前的摘要实现极其简单：

```typescript
// src/session/compact.ts:31-51
const summaryParts: string[] = [];
for (let i = 0; i < Math.min(3, messages.length); i++) {
  const msg = messages[i];
  // 只取前 3 条消息的前 200 字符
}
```

取的是**前 3 条**消息，而非最近的消息。这导致：
- 长会话中，早期无关的寒暄被保留
- 最近的、关键的工具调用结果和决策被丢弃
- 摘要几乎无法保留有效上下文

### 影响

Compact 机制形同虚设。压缩后 LLM 获得的 "摘要" 不包含最近对话的核心信息，导致：
- 用户需要重复描述问题
- 工具调用结果丢失，LLM 无法基于之前的执行继续
- 整体体验劣于不压缩

### 建议修复方案

**方案 A：近期消息优先（短期）**
- 改为取**最后 N 条**消息（如最近 5 条），而非前 3 条
- 保留最近的用户指令、assistant 回复和工具结果

**方案 B：结构化摘要（中期）**
- 按消息角色分类统计：
  - 用户请求了几件事
  - 执行了哪些工具调用，结果如何
  - Assistant 做了哪些关键决策
- 生成类似 "已执行 X、Y、Z 工具，当前在解决 Q 问题" 的结构化摘要

**方案 C：LLM 生成摘要（长期）**
- 注入 `summarizeFn` 依赖到 `CompactTrigger`
- 当配置时，调用 LLM 生成真正的语义摘要
- 未配置时回退到方案 A/B

### 验收标准

- [ ] 摘要包含最近 5 条消息的关键信息
- [ ] 工具调用结果被正确提取和呈现
- [ ] 测试：压缩后恢复的消息能让 LLM 理解上下文

---

## ISSUE-2: SessionStorage 缺少文件锁

### 问题描述

`SessionStorage.appendEntry()` 使用裸 `fs.appendFileSync` 写入 JSONL 文件：

```typescript
// src/session/session-storage.ts:31-33
appendEntry(filePath: string, entry: Entry): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(filePath, line, { encoding: "utf-8" });
}
```

Node.js 的 `appendFileSync` 在操作系统层面**不保证原子性**。如果两个进程/线程同时写入同一文件，可能出现行交错。

虽然 `proper-lockfile` 已在 `package.json` 的依赖列表中（项目初始化时预留），但当前未使用。

### 影响

- **低概率场景：** 用户同时启动两个 `ys-code` 实例，同时操作同一会话
- **后果：** JSONL 文件损坏，行格式被破坏，导致 `readAllEntries()` 跳过损坏行时丢失数据

### 建议修复方案

在 `SessionStorage` 中集成 `proper-lockfile`：

```typescript
import * as lockfile from "proper-lockfile";

appendEntry(filePath: string, entry: Entry): void {
  const release = lockfile.lockSync(filePath);
  try {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, { encoding: "utf-8" });
  } finally {
    release();
  }
}
```

注意：需要考虑锁超时和异常处理。

### 验收标准

- [ ] `appendEntry` 和 `createSession` 使用 `proper-lockfile` 保护
- [ ] 并发写入测试：模拟两个进程同时写入，验证文件完整性
- [ ] 锁异常处理：锁获取失败时有合理降级策略

---

## ISSUE-3: findActiveBranch 叶子节点选择策略

### 问题描述

`SessionLoader.findActiveBranch()` 在多个叶子节点时，**按数组顺序选择最后一个**：

```typescript
// src/session/session-loader.ts:36
const leaf = leaves[leaves.length - 1];
```

数组顺序取决于 `readAllEntries()` 的读取顺序，即**磁盘上 entry 的写入顺序**。

这导致：
- 多个分支时，选择策略不可预测
- 无法显式指定要恢复哪个分支
- 与 "DAG 支持未来 fork" 的设计意图不匹配

### 影响

当前影响较小（fork 功能未实现），但一旦支持分支：
- 用户无法恢复到期望的分支
- 可能需要重放整个会话才能到达目标分支

### 建议修复方案

**短期：** 增加显式叶子选择参数

```typescript
restoreMessages(entries: Entry[], leafUuid?: string): AgentMessage[] {
  const activeBranch = leafUuid 
    ? this.findBranchFromLeaf(entries, leafUuid)
    : this.findActiveBranch(entries);
}
```

**长期：** 
- `SessionManager` 记录当前活跃分支的叶子 UUID
- 提供 `switchBranch(leafUuid)` API
- UI 层展示分支树供用户选择

### 验收标准

- [ ] `restoreMessages` 支持传入 `leafUuid` 参数
- [ ] 多个叶子节点时，无 `leafUuid` 抛出明确错误（而非静默选择）
- [ ] 测试：多分支场景下能正确恢复指定分支

---

## ISSUE-4: findLatestSessionFile 不区分 cwd

### 问题描述

`SessionStorage.findLatestSessionFile()` 返回全局最新修改的 `.jsonl` 文件，**不检查 `cwd` 是否匹配**：

```typescript
// src/session/session-storage.ts:54-65
findLatestSessionFile(): string | null {
  const files = fs.readdirSync(this.baseDir)
    .filter(f => f.endsWith(".jsonl"))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0].path : null;
}
```

这意味着：
- 用户在 `/projectA` 工作后切换到 `/projectB`
- `restoreLatest` 可能恢复 `/projectA` 的会话
- 导致错误的上下文被注入

### 影响

- 跨项目使用时的用户体验问题
- 可能导致敏感信息泄露（一个项目的文件路径暴露给另一个项目）

### 建议修复方案

**方案 A：按 cwd 过滤（简单）**

```typescript
findLatestSessionFile(targetCwd: string): string | null {
  // 读取所有文件 header，过滤 cwd 匹配项
  const sessions = fs.readdirSync(this.baseDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => {
      const path = path.join(this.baseDir, f);
      const entries = this.readAllEntries(path);
      const header = entries.find(e => e.type === "header") as HeaderEntry;
      return { path, header, mtime: fs.statSync(path).mtimeMs };
    })
    .filter(s => s.header?.cwd === targetCwd)
    .sort((a, b) => b.mtime - a.mtime);
  
  return sessions.length > 0 ? sessions[0].path : null;
}
```

**方案 B：按 cwd 分子目录（更好）**

```
~/.ys-code/sessions/
  <cwd-hash-1>/
    1234567890_session-1.jsonl
  <cwd-hash-2>/
    1234567891_session-2.jsonl
```

- 天然隔离不同项目
- `findLatestSessionFile` 只需查看对应子目录
- 避免读取所有文件来过滤

### 验收标准

- [ ] `findLatestSessionFile` 接受 `cwd` 参数并过滤
- [ ] 测试：不同 cwd 的会话互不干扰
- [ ] 测试：相同 cwd 下正确找到最新会话

---

## ISSUE-5: AgentMessage 类型系统不完整

### 问题描述

当前 `AgentMessage` 定义为：

```typescript
// src/agent/types.ts:39
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// src/core/ai/types.ts:170
export type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

注意：**没有 `SystemMessage`**。这导致多处代码需要使用 `as unknown as AgentMessage`：

- `session-loader.ts:16-19` — compact_boundary 转 system 消息
- `session-loader.ts:69-78` — toolResult 消息
- `compact.ts:53` — system 摘要消息估算

### 影响

- 类型断言绕过了 TypeScript 的保护
- 如果底层类型变化，这些断言会产生运行时错误
- 新开发者难以理解 "为什么这里需要类型断言"

### 建议修复方案

**在 `core/ai/types.ts` 中显式定义 SystemMessage：**

```typescript
export interface SystemMessage {
  role: "system";
  content: (TextContent)[];
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage | SystemMessage;
```

**或者在 `CustomAgentMessages` 中扩展：**

```typescript
// src/agent/types.ts
export interface CustomAgentMessages {
  system: SystemMessage;
  // 现有的 attachment 等...
}
```

### 验收标准

- [ ] `Message` 或 `AgentMessage` 包含 `system` 角色
- [ ] 移除所有 `as unknown as AgentMessage` 中与 system/toolResult 相关的断言
- [ ] TypeScript 编译通过
- [ ] 所有测试通过

---

## 修复优先级建议

```
第一阶段（立即修复）:
  - ISSUE-2: 文件锁（数据完整性）
  - ISSUE-4: cwd 过滤（用户体验）

第二阶段（下个迭代）:
  - ISSUE-1: 摘要质量（功能有效性）
  - ISSUE-5: 类型系统（代码质量）

第三阶段（fork 功能开发时）:
  - ISSUE-3: 分支选择策略
```

---

## 关联文件

| 文件 | 涉及问题 |
|------|----------|
| `src/session/compact.ts` | ISSUE-1 |
| `src/session/session-storage.ts` | ISSUE-2, ISSUE-4 |
| `src/session/session-loader.ts` | ISSUE-3, ISSUE-5 |
| `src/session/token-estimator.ts` | ISSUE-5 |
| `src/core/ai/types.ts` | ISSUE-5 |
