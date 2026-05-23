# Compact 系统后续问题跟踪

> **状态:** 基于 `docs/cc/persistence-compact-followup.md` 更新，补充 ys-code 对齐状态
> **创建日期:** 2026-04-22
> **更新日期:** 2026-05-23

---

## 问题清单

| 编号 | 问题 | 优先级 | 影响范围 | ys-code 状态 | 预计工作量 |
|------|------|--------|----------|--------------|-----------|
| ISSUE-1 | Compact 摘要质量仅为占位级 | P1 | 上下文压缩效果 | 未实现 | 中等 |
| ISSUE-2 | SessionStorage 缺少文件锁 | P1 | 数据完整性 | 未实现 | 小 |
| ISSUE-3 | findActiveBranch 叶子节点选择策略 | P2 | 多分支恢复 | 未实现 | 小 |
| ISSUE-4 | findLatestSessionFile 不区分 cwd | P2 | 跨项目恢复 | 未实现 | 小 |
| ISSUE-5 | AgentMessage 类型系统不完整 | P3 | 类型安全 | 未实现 | 中等 |
| ISSUE-6 | 缺少多级压缩策略 | P1 | 压缩效率 | 未实现 | 中等 |
| ISSUE-7 | 缺少缓存复用机制 | P1 | 压缩成本 | 未实现 | 大 |
| ISSUE-8 | 缺少熔断机制 | P2 | 系统稳定性 | 未实现 | 小 |

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

> **ys-code 现状:** 未实现。当前无 compact 机制，无摘要生成逻辑。

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

> **建议:** [P0] 实现方案 A 作为 MVP，后续迭代到方案 C。

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

> **ys-code 现状:** 未实现。当前无 SessionStorage，无持久化层。

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

> **建议:** [P0] 在实现 SessionStorage 时直接集成文件锁，避免后续重构。

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

> **ys-code 现状:** 未实现。当前无 SessionLoader，无分支概念。

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

> **建议:** [P2] 在实现树形会话结构时预留 `leafUuid` 参数，避免后续 Breaking Change。

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

> **ys-code 现状:** 未实现。当前无 SessionStorage，无会话恢复功能。

### 建议修复方案

**方案 A：按 cwd 过滤（简单）**

```typescript
findLatestSessionFile(targetCwd: string): string | null {
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

> **建议:** [P0] 直接采用方案 B（按 cwd 分子目录），避免后续迁移成本。

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

> **ys-code 现状:** 未实现。当前 `AgentMessage` 类型尚未定义 SystemMessage，但无持久化层故无类型断言问题。

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

> **建议:** [P1] 在定义 Message 类型体系时直接包含 SystemMessage，避免后续重构。

### 验收标准

- [ ] `Message` 或 `AgentMessage` 包含 `system` 角色
- [ ] 移除所有 `as unknown as AgentMessage` 中与 system/toolResult 相关的断言
- [ ] TypeScript 编译通过
- [ ] 所有测试通过

---

## ISSUE-6: 缺少多级压缩策略

### 问题描述

Claude Code 采用 microCompact → sessionMemoryCompact → compactConversation 的多级压缩策略，而当前 ys-code 设计仅考虑单一全量压缩。

### 影响

- 每次触发都进行全量压缩，成本高
- 无法处理 "短时间间隔内大量工具调用" 的场景
- 无法利用 "用户离开较长时间" 的场景做轻量清理

> **ys-code 现状:** 未实现。当前无 compact 机制，无多级压缩设计。

### 建议修复方案

引入 Claude Code 风格的多级压缩：

```typescript
// Level 1: Time-based microCompact
// 距离上条 assistant 消息 > 60 分钟，清除旧 tool results，保留最近 5 个

// Level 2: Cached microCompact
// 使用 cache_edits API 编辑缓存，不使缓存失效

// Level 3: Full compact
// 生成结构化摘要，保留最近消息和附件
```

> **建议:** [P1] 在 MVP 中仅实现 Level 3（全量压缩），后续迭代引入 Level 1/2。

### 验收标准

- [ ] 定义 microCompact 和 full compact 的触发条件
- [ ] Time-based MC 清除旧 tool results 不破坏 API 不变量
- [ ] 测试：多级压缩的触发顺序正确

---

## ISSUE-7: 缺少缓存复用机制

### 问题描述

Claude Code 通过 Forked Agent 复用主对话的 prompt cache key，实现 98% 缓存命中率，显著降低压缩成本。Pi-mono 无此机制，每次压缩直接调用 LLM。

### 影响

- 每次压缩都产生完整的 LLM 调用成本
- 长会话频繁压缩时成本累积显著
- 压缩延迟高（需等待 LLM 生成摘要）

> **ys-code 现状:** 未实现。当前无 Forked Agent 机制，无 prompt cache 概念。

### 建议修复方案

**短期：** 直接调用 LLM（Pi-mono 风格）

**长期：** 引入 Forked Agent 缓存复用

```typescript
const result = await runForkedAgent({
  promptMessages: [summaryRequest],
  cacheSafeParams,  // 复用主对话的 cache key
  canUseTool: createCompactCanUseTool(),  // 禁用工具
  querySource: 'compact',
  forkLabel: 'compact',
  maxTurns: 1,
  skipCacheWrite: true,
});
```

> **建议:** [P1] MVP 阶段采用直接调用 LLM，后续引入 Forked Agent 机制。

### 验收标准

- [ ] 压缩摘要生成成功
- [ ] 缓存复用时命中率达到预期（> 90%）
- [ ] 降级到直接调用时功能正常

---

## ISSUE-8: 缺少熔断机制

### 问题描述

Claude Code 在连续 3 次压缩失败后停止自动压缩，防止不可恢复场景下无限重试。当前 ys-code 设计无此机制。

### 影响

- 上下文持续超限，每次请求都触发压缩
- 压缩反复失败，浪费 API 调用
- 用户体验极差（每次请求都卡顿然后失败）

> **ys-code 现状:** 未实现。当前无 compact 机制，无熔断需求。

### 建议修复方案

引入熔断机制：

```typescript
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

export async function autoCompactIfNeeded(
  messages: Message[],
  tracking?: AutoCompactTrackingState,
): Promise<{ wasCompacted: boolean }> {
  if (tracking?.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return { wasCompacted: false };  // 熔断，停止尝试
  }
  
  try {
    const result = await compactConversation(...);
    return { wasCompacted: true, consecutiveFailures: 0 };
  } catch (error) {
    return { wasCompacted: false, consecutiveFailures: (tracking?.consecutiveFailures ?? 0) + 1 };
  }
}
```

> **建议:** [P2] 在实现 autoCompact 时同步引入熔断机制。

### 验收标准

- [ ] 连续 3 次失败后停止自动压缩
- [ ] 手动 `/compact` 不受熔断限制
- [ ] 熔断状态可观测（日志或状态查询）

---

## 修复优先级建议

```
第一阶段（MVP 必备）:
  - ISSUE-1: 摘要质量（功能有效性）
  - ISSUE-2: 文件锁（数据完整性）
  - ISSUE-4: cwd 过滤（用户体验）

第二阶段（下个迭代）:
  - ISSUE-5: 类型系统（代码质量）
  - ISSUE-6: 多级压缩（压缩效率）
  - ISSUE-8: 熔断机制（系统稳定性）

第三阶段（高级功能）:
  - ISSUE-3: 分支选择策略（fork 功能开发时）
  - ISSUE-7: 缓存复用（成本优化）
```

---

## 关联文件

| 文件 | 涉及问题 | 状态 |
|------|----------|------|
| `src/session/compact.ts` | ISSUE-1, ISSUE-5 | 未创建 |
| `src/session/session-storage.ts` | ISSUE-2, ISSUE-4 | 未创建 |
| `src/session/session-loader.ts` | ISSUE-3, ISSUE-5 | 未创建 |
| `src/session/token-estimator.ts` | ISSUE-5 | 未创建 |
| `src/core/ai/types.ts` | ISSUE-5 | 未创建 |
| `src/services/compact/` | ISSUE-6, ISSUE-7, ISSUE-8 | 未创建 |

---

## 参考链接

- **原始问题跟踪**: `docs/cc/persistence-compact-followup.md`
- **Claude Code 熔断实现**: `refer/claude-code-haha/src/services/compact/autoCompact.ts`
- **Claude Code 缓存复用**: `refer/claude-code-haha/src/services/compact/compact.ts`
- **Pi-mono 会话存储**: `refer/pi-mono/packages/coding-agent/src/core/session-manager.ts`
- **ys-code 依赖**: `package.json` 中已预留 `proper-lockfile`
