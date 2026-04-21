# Claude Code vs Pi-mono Compact 系统对比分析

## 1. 概述

| 项目 | Claude Code | Pi-mono |
|------|-------------|---------|
| **源码位置** | `src/services/compact/` | `packages/coding-agent/src/core/compaction/` |
| **代码规模** | ~2,400 行（10 个文件） | ~1,350 行（4 个文件） |
| **架构风格** | 扁平化，微压缩多层 | 扁平化，单一压缩 |

---

## 2. 触发机制对比

### 2.1 Claude Code

```typescript
// autoCompact.ts
// 阈值计算
effectiveContextWindow = contextWindow - maxOutputTokens - 20,000
autoCompactThreshold = effectiveContextWindow - 13,000

// 触发条件
shouldAutoCompact() {
  // 1. 递归守卫：session_memory 和 compact 跳过
  if (querySource === 'session_memory' || querySource === 'compact') return false

  // 2. CONTEXT_COLLAPSE 模式跳过
  if (feature('CONTEXT_COLLAPSE') && isContextCollapseEnabled()) return false

  // 3. REACTIVE_COMPACT 模式可选跳过
  if (feature('REACTIVE_COMPACT') && ...) return false

  // 4. 检查 token 阈值
  return tokenCount >= autoCompactThreshold
}
```

### 2.2 Pi-mono

```typescript
// compaction.ts
// 阈值计算
shouldCompact(contextTokens, contextWindow, settings) {
  return contextTokens > contextWindow - settings.reserveTokens
}

// 默认配置
DEFAULT_COMPACTION_SETTINGS = {
  reserveTokens: 16384,     // 预留
  keepRecentTokens: 20000,  // 保留
}
```

### 2.3 对比表

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **触发公式** | `tokens > window - 13,000` | `tokens > window - 16,384` |
| **熔断机制** | 连续 3 次失败后停止 | 无 |
| **递归守卫** | 有（session_memory, compact） | 无明确递归守卫 |
| **特性开关** | GrowthBook 远程配置 | 配置文件本地 |

---

## 3. 压缩流程对比

### 3.1 Claude Code 流程

```
┌──────────────────────────────────────────────────────────────────┐
│                     Claude Code Compact Flow                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────┐ │
│  │microCompact │───▶│sessionMemoryCompact│───▶│compactConversation│ │
│  │ (可选，轻量) │    │   (实验性，优先)   │    │   (核心，全量)   │ │
│  └─────────────┘    └──────────────────┘    └────────────────┘ │
│         │                     │                       │         │
│         │                     ▼                       │         │
│         │            ┌────────────────┐                │         │
│         │            │ forkAgentCache │                │         │
│         │            │   或 Streaming  │                │         │
│         │            └────────────────┘                │         │
│         │                                               ▼         │
│         │                                    ┌────────────────┐   │
│         │                                    │ Post-compact    │   │
│         │                                    │ Attachments     │   │
│         │                                    │ - 文件恢复      │   │
│         │                                    │ - 技能附件      │   │
│         │                                    │ - 计划附件      │   │
│         │                                    └────────────────┘   │
│         ▼                                               │         │
│  ┌──────────────────┐                                    │         │
│  │ runPostCompact   │◀───────────────────────────────────┘         │
│  │ Cleanup          │                                               │
│  └──────────────────┘                                               │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Pi-mono 流程

```
┌──────────────────────────────────────────────────────────────────┐
│                       Pi-mono Compact Flow                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐    ┌────────────────────────────────────┐ │
│  │ prepareCompaction │───▶│ findCutPoint()                      │ │
│  │ (准备切割点)       │    │ - findValidCutPoints()              │ │
│  └──────────────────┘    │ - 向后累加直到 keepRecentTokens     │ │
│                           └────────────────────────────────────┘ │
│                                           │                       │
│                                           ▼                       │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ compact()                                                       ││
│  │                                                                  ││
│  │ 1. 提取 messagesToSummarize                                      ││
│  │ 2. 如果 splitTurn，提取 turnPrefixMessages                      ││
│  │ 3. 生成摘要（支持迭代更新前一个摘要）                              ││
│  │ 4. 提取文件操作到 details                                        ││
│  │ 5. 返回 CompactionResult                                         ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### 3.3 流程对比表

| 阶段 | Claude Code | Pi-mono |
|------|-------------|---------|
| **预处理** | microCompact（可选） | prepareCompaction（必须） |
| **摘要策略** | 全量压缩 | 从上一次压缩边界开始 |
| **摘要生成** | Forked Agent 或 Streaming | 直接 LLM 调用 |
| **迭代摘要** | 不支持 | 支持（UPDATE_SUMMARIZATION_PROMPT） |
| **附件恢复** | 文件、技能、计划、Agent | 仅文件操作追踪 |
| **后处理** | runPostCompactCleanup | SessionManager 追加 CompactionEntry |

---

## 4. 摘要格式对比

### 4.1 Claude Code 格式

```xml
<analysis>
[模型思考过程 - 草稿，最终会移除]
</analysis>

<summary>
1. Primary Request and Intent:
   [详细描述用户请求]

2. Key Technical Concepts:
   - [概念1]
   - [概念2]

3. Files and Code Sections:
   - [文件名]
     - [为什么重要]
     - [代码片段]

4. Errors and fixes:
   - [错误描述]:
     - [如何修复]

5. Problem Solving:
   [问题解决描述]

6. All user messages:
   - [用户消息]

7. Pending Tasks:
   - [待办任务]

8. Current Work:
   [当前工作描述]

9. Optional Next Step:
   [下一步]
</summary>
```

### 4.2 Pi-mono 格式

```markdown
## Goal
[用户目标]

## Constraints & Preferences
- [约束或需求]

## Progress
### Done
- [x] [已完成任务]

### In Progress
- [ ] [进行中]

### Blocked
[阻塞问题]

## Key Decisions
- **[决策]**: [理由]

## Next Steps
1. [下一步列表]

## Critical Context
[关键上下文]

## Additional Context (optional)
...

[文件列表]
```

### 4.3 格式对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **结构** | 9 部分强制 | 5 部分强制 + 可选 |
| **格式** | XML 标签 | Markdown |
| **草稿** | 有（`<analysis>`，会被移除） | 无 |
| **文件追踪** | 压缩后重新注入附件 | 直接追加到摘要 |
| **用户消息** | 独立部分 | 纳入 Goal/Progress |

---

## 5. 切割策略对比

### 5.1 Claude Code

```typescript
// compact.ts
// 1. 使用 groupMessagesByApiRound() 按 API 轮次分组
groupMessagesByApiRound(messages) {
  // message.id 变化时创建新边界
}

// 2. 切割点必须在有效位置
// 有效位置：user, assistant 消息
// 无效位置：tool_result（必须跟随 tool_use）
```

### 5.2 Pi-mono

```typescript
// compaction.ts
// 1. 找到所有有效切割点
findValidCutPoints(entries) {
  // 有效：user, assistant, bashExecution, custom, branchSummary, compactionSummary
  // 无效：toolResult
}

// 2. 从最新向后累加 token 直到 keepRecentTokens
findCutPoint(entries, keepRecentTokens) {
  let accumulated = 0;
  for (i = endIndex - 1; i >= startIndex; i--) {
    accumulated += estimateTokens(entry.message);
    if (accumulated >= keepRecentTokens) {
      return cutPoints[c];  // 找到最近的合法切割点
    }
  }
}
```

### 5.3 切割策略对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **分组依据** | API 轮次（message.id） | Token 预算 |
| **切割单位** | API 轮次边界 | 消息边界 |
| **Split Turn** | 支持（partialCompact） | 支持（turnPrefixMessages） |
| **保留策略** | 固定 token 预算 | 固定 recent tokens |

---

## 6. 文件追踪对比

### 6.1 Claude Code

```typescript
// compact.ts
// 压缩后重新注入文件附件
createPostCompactFileAttachments() {
  // 1. 从 readFileState 获取最近访问文件
  // 2. 过滤 plan 文件和 memory 文件
  // 3. 重新生成文件附件
  // 4. 总预算 50K tokens
}

// 技能附件
createSkillAttachmentIfNeeded() {
  // 每个技能最多 5K tokens
  // 总预算 25K tokens
}
```

### 6.2 Pi-mono

```typescript
// utils.ts
// 直接累积到摘要
extractFileOpsFromMessage(message, fileOps) {
  if (block.name === "read") fileOps.read.add(path);
  if (block.name === "write") fileOps.written.add(path);
  if (block.name === "edit") fileOps.edited.add(path);
}

formatFileOperations(readFiles, modifiedFiles) {
  // 追加到摘要
  return `
<read-files>
${readFiles.join('\n')}
</read-files>

<modified-files>
${modifiedFiles.join('\n')}
</modified-files>`;
}
```

### 6.3 文件追踪对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **追踪方式** | 压缩后重新注入 | 直接累积到摘要 |
| **文件预算** | 50K tokens | 无硬限制 |
| **技能处理** | 重新注入附件 | 不追踪 |
| **计划处理** | 重新注入附件 | 不追踪 |

---

## 7. 扩展机制对比

### 7.1 Claude Code Hooks

```typescript
// hooks.ts
// PreCompact Hooks
executePreCompactHooks({
  trigger: 'auto' | 'manual',
  customInstructions: ...
})

// PostCompact Hooks
executePostCompactHooks({
  trigger: 'auto' | 'manual',
  compactSummary: ...
})

// SessionStart Hooks
processSessionStartHooks('compact', { model })
```

### 7.2 Pi-mono Extensions

```typescript
// extensions/types.ts
// session_before_compact
pi.on("session_before_compact", async (event, ctx) => {
  // event.preparation - CompactionPreparation
  // event.branchEntries - 所有分支条目
  // event.customInstructions - 自定义指令
  // event.signal - AbortSignal

  return {
    cancel: true,  // 或
    compaction: {
      summary: "...",
      firstKeptEntryId: "...",
      tokensBefore: 12345,
      details: { readFiles: [], modifiedFiles: [] }
    }
  };
});
```

### 7.3 扩展机制对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **Hook 类型** | Pre/Post/SessionStart | session_before_compact |
| **返回方式** | 修改上下文 | 取消或自定义结果 |
| **自定义摘要** | 通过 customInstructions | 直接返回 summary 对象 |
| **分支支持** | 无 | session_before_tree |

---

## 8. 树形会话支持

### 8.1 Claude Code

- **无原生树形支持**
- 通过 `partialCompactConversation()` 支持部分压缩
- 方向：`from`（保留早期）或 `up_to`（保留最新）

### 8.2 Pi-mono

```typescript
// branch-summarization.ts
// 分支摘要流程
collectEntriesForBranchSummary(session, oldLeafId, targetId) {
  // 1. 找到共同祖先
  // 2. 从旧叶子收集到共同祖先的条目
  // 3. 反转为时间顺序
}

// 生成摘要
generateBranchSummary(entries, options) {
  // 1. prepareBranchEntries() - 提取消息和文件操作
  // 2. serializeConversation() - 序列化为文本
  // 3. 调用 LLM 生成摘要
}
```

### 8.4 树形支持对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **树形结构** | 无 | SessionManager 原生支持 |
| **分支摘要** | 无 | BranchSummaryEntry |
| **摘要累积** | 无 | 跨多个分支累积 |
| **导航触发** | 无 | /tree 命令 |

---

## 9. 缓存策略对比

### 9.1 Claude Code

```typescript
// compact.ts
// 优先：Forked Agent 复用 prompt cache
const result = await runForkedAgent({
  promptMessages: [summaryRequest],
  cacheSafeParams,  // 复用主对话的 cache key
  maxTurns: 1,
  skipCacheWrite: true,
})

// 降级：Regular Streaming
const streamingGen = queryModelWithStreaming({
  messages: normalizeMessagesForAPI(...),
  thinkingConfig: { type: 'disabled' },
  tools: [FileReadTool],
})
```

### 9.2 Pi-mono

```typescript
// compaction.ts
// 直接调用 LLM
const response = await completeSimple(
  model,
  {
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: summarizationMessages
  },
  { maxTokens, signal, apiKey, headers }
)
```

### 9.3 缓存策略对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **缓存复用** | Forked Agent（98% 命中率） | 无 |
| **降级方案** | Regular Streaming | 直接调用 |
| **Thinking** | 禁用 | 可选启用 |
| **工具** | 只读（FileReadTool） | 无 |

---

## 10. 微压缩对比

### 10.1 Claude Code

```typescript
// microCompact.ts
// 1. Time-based MC
evaluateTimeBasedTrigger(messages, querySource) {
  // 距离上一条 assistant 消息 > 60 分钟
  // 清除旧 tool results，保留最近 5 个
}

// 2. Cached MC
cachedMicrocompactPath(messages) {
  // 使用 cache_edits API 编辑缓存
  // 不使缓存失效
}
```

### 10.2 Pi-mono

- **无微压缩机制**
- 仅支持全量压缩

### 10.3 微压缩对比

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **Time-based MC** | 有（60 分钟阈值） | 无 |
| **Cached MC** | 有（GrowthBook 配置） | 无 |
| **工具限制** | COMPACTABLE_TOOLS 列表 | 无 |

---

## 11. Session Memory 对比

### 11.1 Claude Code

```typescript
// sessionMemoryCompact.ts
trySessionMemoryCompaction(messages, agentId, threshold) {
  // 1. 检查 GrowthBook 特性
  if (!shouldUseSessionMemoryCompaction()) return null

  // 2. 等待 session memory 提取完成
  await waitForSessionMemoryExtraction()

  // 3. 计算保留消息起始位置
  const startIndex = calculateMessagesToKeepIndex(messages, lastSummarizedIndex)

  // 4. 使用 session memory 作为摘要
  return createCompactionResultFromSessionMemory(...)
}
```

### 11.2 Pi-mono

- **无 Session Memory 机制**

---

## 12. 核心架构对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐                                               │
│   │ autoCompact │ ◀── 触发器（阈值计算）                          │
│   └──────┬──────┘                                               │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│   │   micro     │───▶│ sessionMemory│───▶│     compact     │   │
│   │   Compact   │    │   Compact    │    │   Conversation  │   │
│   └─────────────┘    └──────────────┘    └────────┬────────┘   │
│                                                    │             │
│                     ┌──────────────────────────────┘             │
│                     │                                          │
│                     ▼                                          │
│            ┌─────────────────┐                                 │
│            │   Stream        │                                 │
│            │   Summary        │                                 │
│            │ (fork/streaming)│                                 │
│            └─────────────────┘                                 │
│                                                                  │
│                     ┌──────────────────────────────┐             │
│                     │     Post-compact             │             │
│                     │     Attachments              │             │
│                     │ - FileRestore               │             │
│                     │ - SkillAttachment           │             │
│                     │ - PlanAttachment            │             │
│                     └──────────────────────────────┘             │
│                                                                  │
│                     ┌──────────────────────────────┐             │
│                     │   Post-compact Cleanup       │             │
│                     │ - Cache resets              │             │
│                     │ - Context collapse          │             │
│                     └──────────────────────────────┘             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Pi-mono Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────────┐│
│   │                    SessionManager                            ││
│   │  - Entry types: message, compaction, branch_summary        ││
│   │  - Tree structure with parent/child relationships           ││
│   │  - Persisted to JSONL                                       ││
│   └─────────────────────────────────────────────────────────────┘│
│                              │                                    │
│                              ▼                                    │
│   ┌─────────────────────────────────────────────────────────────┐│
│   │                   Compaction Module                          ││
│   │                                                             ││
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ ││
│   │  │ prepareCompaction │─▶│ findCutPoint()   │─▶│  compact()   │ ││
│   │  └─────────────────┘  └─────────────────┘  └──────┬──────┘ ││
│   │                                                     │        ││
│   │  ┌─────────────────────────────────────────────────┘        ││
│   │  │                                                         ││
│   │  ▼                                                         ││
│   │  ┌─────────────────────────────────────────────────────────┐││
│   │  │              generateSummary()                          │││
│   │  │  - serializeConversation()                              │││
│   │  │  - completeSimple() → LLM                               │││
│   │  │  - formatFileOperations()                               │││
│   │  └─────────────────────────────────────────────────────────┘││
│   │                                                             ││
│   └─────────────────────────────────────────────────────────────┘│
│                              │                                    │
│                              ▼                                    │
│   ┌─────────────────────────────────────────────────────────────┐│
│   │                 BranchSummarization                          ││
│   │  - collectEntriesForBranchSummary()                         ││
│   │  - generateBranchSummary()                                  ││
│   │  - Cumulative file tracking                                  ││
│   └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. 优缺点分析

### 13.1 Claude Code 优点

| 优点 | 说明 |
|------|------|
| **缓存复用** | Forked Agent 复用 prompt cache，98% 命中率 |
| **熔断机制** | 连续失败 3 次后停止，防止无限重试 |
| **微压缩** | Time-based 和 Cached MC 减少全量压缩频率 |
| **多级压缩** | microCompact → sessionMemoryCompact → compact |
| **附件恢复** | 文件、技能、计划等在压缩后完整恢复 |
| **Session Memory** | 实验性支持，更轻量的压缩方式 |

### 13.2 Claude Code 缺点

| 缺点 | 说明 |
|------|------|
| **复杂度高** | 10 个文件，约 2400 行代码 |
| **树形支持弱** | 无原生分支摘要机制 |
| **迭代摘要** | 不支持，每次压缩独立 |
| **无扩展点** | Hook 机制但不如 pi-mono 灵活 |

### 13.3 Pi-mono 优点

| 优点 | 说明 |
|------|------|
| **树形支持** | 原生 SessionManager 支持分支和摘要 |
| **迭代摘要** | 支持更新前一个摘要，保持连贯性 |
| **累积追踪** | 跨多次压缩和分支累积文件操作 |
| **简洁** | 4 个核心文件，约 1350 行代码 |
| **扩展灵活** | session_before_compact 可完全自定义 |
| **/tree 集成** | 导航时自动触发分支摘要 |

### 13.4 Pi-mono 缺点

| 缺点 | 说明 |
|------|------|
| **无缓存复用** | 每次压缩直接调用 LLM |
| **无微压缩** | 只有全量压缩 |
| **无熔断** | 失败时无退避机制 |
| **附件简单** | 仅文件操作追踪，无完整附件恢复 |
| **Session Memory** | 无此机制 |

---

## 14. 适用场景

| 场景 | 推荐 |
|------|------|
| **简单对话** | Pi-mono（更简洁） |
| **复杂长对话** | Claude Code（多级压缩） |
| **树形分支多** | Pi-mono（原生支持） |
| **文件密集** | Claude Code（附件恢复） |
| **成本敏感** | Claude Code（缓存复用） |
| **需要扩展** | Pi-mono（灵活的事件机制） |
| **轻量实现** | Pi-mono（代码量少） |

---

## 15. 总结

| 维度 | Claude Code | Pi-mono |
|------|-------------|---------|
| **设计理念** | 多层防护，缓存优先 | 简洁直接，树形原生 |
| **压缩粒度** | 微压缩 → 全量压缩 | 仅全量压缩 |
| **缓存策略** | Forked Agent 98% 命中 | 无缓存 |
| **树形支持** | 无 | BranchSummary 原生 |
| **扩展性** | Hooks | Events + 自定义结果 |
| **代码规模** | ~2400 行 | ~1350 行 |
| **生产成熟度** | 高（Claude Code 生产使用） | 中（开源项目） |
