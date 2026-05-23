# Compact 系统概述

## 1. 背景与定位

Compact（上下文压缩）系统是对话式 AI 工具管理长对话上下文的核心机制。当对话 Token 数量接近模型上下文窗口限制时，系统通过压缩历史消息为摘要来释放上下文空间，确保对话能持续进行而不丢失关键信息。

> **ys-code 现状:** 未实现。当前消息纯内存存储（`Agent._state.messages: AgentMessage[]`），无持久化、无会话恢复、无 compact。

---

## 2. 核心原理

### 2.1 Claude Code 架构

Claude Code 采用**多级压缩**策略，从轻到重依次尝试：

```
microCompact（轻量级清理） → sessionMemoryCompact（实验性） → compactConversation（全量压缩）
```

**触发条件**：当 `tokenCount >= contextWindow - 33,000` 时触发（预留 20K 输出 + 13K 缓冲）。

**核心流程**：
1. **Pre-compact**：执行 hooks，合并自定义指令
2. **Generate Summary**：流式生成摘要（带 PTL 重试）
3. **Post-compact Cleanup**：清理缓存、生成附件、执行 SessionStart hooks
4. **Telemetry**：记录压缩事件和指标

**关键设计**：
- **Forked Agent 缓存复用**：复用主对话的 prompt cache key，98% 命中率
- **熔断机制**：连续 3 次失败后停止自动压缩
- **附件保留**：压缩后重新注入文件、技能、计划等附件

### 2.2 Pi-mono 架构

Pi-mono 采用**单一全量压缩**策略，基于树形会话结构：

**触发条件**：当 `contextTokens > contextWindow - reserveTokens` 时触发（默认预留 16,384）。

**核心流程**：
1. **prepareCompaction**：查找上一次压缩边界，计算切割点
2. **findCutPoint**：从最新消息向后累加 token 直到 `keepRecentTokens`，找到合法切割点
3. **generateSummary**：调用 LLM 生成摘要（支持迭代更新前一个摘要）
4. **SessionManager 追加**：将 `CompactionEntry` 写入会话树

**关键设计**：
- **树形结构**：原生支持分支和分支摘要（`BranchSummaryEntry`）
- **迭代摘要**：支持基于前一个摘要增量更新
- **累积文件追踪**：跨多次压缩和分支累积文件操作

---

## 3. 源码实现

### 3.1 Claude Code 核心文件

```
src/services/compact/
├── compact.ts                    # 核心压缩引擎 (~1700 行)
├── autoCompact.ts               # 自动压缩触发器 (~350 行)
├── microCompact.ts              # 微压缩 (~530 行)
├── sessionMemoryCompact.ts      # 会话记忆压缩 (~630 行)
├── prompt.ts                    # 提示词模板 (~375 行)
├── grouping.ts                  # 消息分组 (~63 行)
├── postCompactCleanup.ts        # 压缩后清理 (~77 行)
└── ...                          # 其他辅助文件
```

**关键代码路径**：

```typescript
// autoCompact.ts: 阈值计算
export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS  // 13,000
}

// compact.ts: 核心压缩流程
export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  suppressFollowUpQuestions: boolean,
  customInstructions?: string,
  isAutoCompact: boolean = false,
): Promise<CompactionResult> {
  // Phase 1: Pre-compact hooks
  // Phase 2: Stream summary (with PTL retry)
  // Phase 3: Post-compact cleanup + attachments
  // Phase 4: Telemetry
  // Phase 5: Post-compact hooks
}

// compact.ts: Forked Agent vs Streaming 双路径
async function streamCompactSummary({ messages, summaryRequest, ... }): Promise<AssistantMessage> {
  // 路径 1: Forked Agent（优先，复用 cache）
  if (promptCacheSharingEnabled) {
    const result = await runForkedAgent({ promptMessages: [summaryRequest], cacheSafeParams, ... })
  }
  // 路径 2: Regular Streaming（降级，禁用 thinking）
  const streamingGen = queryModelWithStreaming({ messages: ..., thinkingConfig: { type: 'disabled' } })
}
```

### 3.2 Pi-mono 核心文件

```
packages/coding-agent/src/core/compaction/
├── compaction.ts           # 自动压缩逻辑 (~823 行)
├── branch-summarization.ts # 分支摘要 (~355 行)
├── utils.ts                # 共享工具 (~170 行)
└── index.ts               # 导出入口
```

**关键代码路径**：

```typescript
// compaction.ts: 阈值判断
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;  // 16,384
}

// compaction.ts: 切割点查找
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  // 从最新向后累加 token 直到 keepRecentTokens
  let accumulatedTokens = 0;
  for (let i = endIndex - 1; i >= startIndex; i--) {
    accumulatedTokens += estimateTokens(entry.message);
    if (accumulatedTokens >= keepRecentTokens) {
      return { firstKeptEntryIndex: cutPoints[c], ... };
    }
  }
}

// compaction.ts: 摘要生成（支持迭代更新）
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model<any>,
  reserveTokens: number,
  previousSummary?: string,  // 有则使用 UPDATE_SUMMARIZATION_PROMPT
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  // ... 调用 LLM
}
```

---

## 4. 与 ys-code 对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **触发方式** | 自动（阈值计算）+ 手动 `/compact` | 自动 + 手动 `/compact` | 未实现 |
| **架构风格** | 多级压缩（micro → sessionMemory → full） | 单一全量压缩 | 无 |
| **消息模型** | 扁平消息列表 | 树形 Session Entries | 扁平数组 |
| **摘要生成** | Forked Agent 复用 cache 或 Streaming | 直接调用 LLM | 未实现 |
| **迭代摘要** | 不支持（每次独立） | 支持（更新前一个摘要） | 未实现 |
| **微压缩** | Time-based + Cached MC | 无 | 未实现 |
| **Session Memory** | 实验性支持 | 无 | 未实现 |
| **树形支持** | 无（仅 partialCompact） | 原生 Branch Summary | 未实现 |
| **文件追踪** | 压缩后重新注入附件 | 累积追踪到 details | 未实现 |
| **熔断机制** | 连续 3 次失败后停止 | 无 | 未实现 |
| **附件恢复** | 文件、技能、计划、Agent | 仅文件操作追踪 | 未实现 |
| **扩展机制** | PreCompact/PostCompact Hooks | session_before_compact event | 未实现 |
| **代码规模** | ~2,400 行（10 文件） | ~1,350 行（4 文件） | 0 |

---

## 5. 可借鉴点与建议

### 5.1 建议对齐 Claude Code 的点

| 特性 | 优先级 | 说明 |
|------|--------|------|
| **多级压缩策略** | P1 | microCompact → full compact 的渐进策略减少全量压缩频率 |
| **Forked Agent 缓存复用** | P1 | 复用 prompt cache 可显著降低压缩成本和延迟 |
| **熔断机制** | P2 | 防止不可恢复场景下无限重试 |
| **附件保留策略** | P2 | 压缩后重新注入关键文件和技能上下文 |
| **PTL 重试机制** | P2 | 压缩请求本身超长时的优雅降级 |

### 5.2 建议对齐 Pi-mono 的点

| 特性 | 优先级 | 说明 |
|------|--------|------|
| **树形会话结构** | P1 | 原生支持分支和分支摘要，为后续 `/tree` 命令打基础 |
| **迭代摘要** | P2 | 基于前一个摘要增量更新，保持连贯性 |
| **累积文件追踪** | P2 | 跨多次压缩累积文件操作，避免重复读取 |
| **简洁实现** | P2 | 4 个文件 ~1,350 行，适合 MVP 快速落地 |

### 5.3 推荐实现路径

> **建议:** [P0] 采用 **Pi-mono 风格树形结构 + Claude Code 多级压缩策略** 的混合方案：

```
Phase 1: Pi-mono 风格持久化（JSONL + 树 + 内存构建）
  ↓
Phase 2: 基于持久化的 Compact（自动/手动触发 + 迭代摘要）
  ↓
Phase 3: 引入 Claude Code 风格的多级压缩（microCompact + 缓存复用）
  ↓
Phase 4: 如果会话文件变大，引入分块截断读取优化
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

## 6. 参考链接

- **Claude Code 源码**: `refer/claude-code-haha/src/services/compact/`
- **Pi-mono 源码**: `refer/pi-mono/packages/coding-agent/src/core/compaction/`
- **Pi-mono 会话文档**: `refer/pi-mono/packages/coding-agent/docs/session.md`
- **Claude Code 持久化**: `refer/claude-code-haha/src/utils/sessionStorage.ts`
