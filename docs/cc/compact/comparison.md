# Claude Code vs Pi-mono Compact 深度对比

## 1. 背景与定位

本文聚焦 Claude Code 和 Pi-mono 两个系统的 Compact 机制在触发策略、压缩流程、消息处理、附件保留等维度的差异，为 ys-code 的 compact 实现提供选型依据。

> **ys-code 现状:** 未实现任何 compact 机制。消息纯内存存储，无持久化、无会话恢复。

---

## 2. 核心原理

### 2.1 触发机制

**Claude Code** 采用多层阈值计算：

```typescript
// 有效窗口 = 原始窗口 - 输出预留(20K)
const effectiveWindow = contextWindow - MAX_OUTPUT_TOKENS_FOR_SUMMARY
// 触发阈值 = 有效窗口 - 缓冲(13K)
const threshold = effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS  // ~33K 预留
```

**Pi-mono** 采用简单预留模式：

```typescript
// 触发条件 = 当前 tokens > 窗口 - 预留(16K)
return contextTokens > contextWindow - settings.reserveTokens
```

### 2.2 压缩策略

**Claude Code**：多级渐进压缩

```
microCompact（可选，轻量） → sessionMemoryCompact（实验性，优先） → compactConversation（核心，全量）
```

**Pi-mono**：单一全量压缩

```
prepareCompaction（计算切割点） → generateSummary（生成摘要） → SessionManager 追加 CompactionEntry
```

---

## 3. 源码实现

### 3.1 触发机制源码

**Claude Code** (`src/services/compact/autoCompact.ts`):

```typescript
export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
): Promise<boolean> {
  // 1. 递归守卫：子 agent 跳过自身压缩
  if (querySource === 'session_memory' || querySource === 'compact') return false
  
  // 2. CONTEXT_COLLAPSE 模式跳过
  if (feature('CONTEXT_COLLAPSE') && isContextCollapseEnabled()) return false
  
  // 3. REACTIVE_COMPACT 模式可选跳过
  if (feature('REACTIVE_COMPACT') && getFeatureValue('tengu_cobalt_raccoon', false)) return false
  
  // 4. 检查 autoCompactEnabled 配置
  if (!isAutoCompactEnabled()) return false
  
  // 5. 计算 token 数量并比较阈值
  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)
  return tokenCount >= threshold
}
```

**Pi-mono** (`packages/coding-agent/src/core/compaction/compaction.ts`):

```typescript
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

// 默认配置
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,     // 预留
  keepRecentTokens: 20000,  // 保留的 recent tokens
};
```

### 3.2 切割策略源码

**Claude Code** (`src/services/compact/compact.ts`):

```typescript
// 按 API 轮次分组（message.id 变化边界）
export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  // 确保 tool_use/tool_result 对不被拆分
}

// PTL 重试时丢弃最旧消息组
export function truncateHeadForPTLRetry(
  messages: Message[],
  ptlResponse: AssistantMessage,
): Message[] | null {
  const groups = groupMessagesByApiRound(input)
  const tokenGap = getPromptTooLongTokenGap(ptlResponse)
  // 精确模式：累加直到覆盖 token 缺口
  // 回退模式：丢弃 20% 的组
}
```

**Pi-mono** (`packages/coding-agent/src/core/compaction/compaction.ts`):

```typescript
// 找到所有有效切割点
function findValidCutPoints(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    if (entry.type === "message") {
      const role = entry.message.role;
      switch (role) {
        case "bashExecution":
        case "custom":
        case "branchSummary":
        case "compactionSummary":
        case "user":
        case "assistant":
          cutPoints.push(i);
          break;
        case "toolResult":
          break;  // Never cut at tool results!
      }
    }
  }
  return cutPoints;
}

// 从最新向后累加 token 直到 keepRecentTokens
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];
  
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    accumulatedTokens += estimateTokens(entry.message);
    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }
  
  return { firstKeptEntryIndex: cutIndex, ... };
}
```

### 3.3 摘要生成源码

**Claude Code** (`src/services/compact/compact.ts`):

```typescript
async function streamCompactSummary({ messages, summaryRequest, ... }): Promise<AssistantMessage> {
  // 路径 1: Forked Agent（优先尝试）
  if (promptCacheSharingEnabled) {
    try {
      const result = await runForkedAgent({
        promptMessages: [summaryRequest],
        cacheSafeParams,  // 复用主对话的 prompt cache key
        canUseTool: createCompactCanUseTool(),  // 禁用工具
        querySource: 'compact',
        forkLabel: 'compact',
        maxTurns: 1,
        skipCacheWrite: true,
      })
      if (assistantMsg && !assistantMsg.isApiErrorMessage) {
        return assistantMsg;  // 98% 缓存命中率
      }
    } catch (error) {
      // 降级到 streaming
    }
  }
  
  // 路径 2: Regular Streaming（降级方案）
  const streamingGen = queryModelWithStreaming({
    messages: normalizeMessagesForAPI(stripImagesFromMessages(stripReinjectedAttachments([...]))),
    systemPrompt: asSystemPrompt(['You are a helpful AI assistant tasked with summarizing conversations.']),
    thinkingConfig: { type: 'disabled' as const },  // 禁用思考
    tools: [FileReadTool],  // 只读工具
    options: {
      maxOutputTokensOverride: Math.min(COMPACT_MAX_OUTPUT_TOKENS, getMaxOutputTokensForModel(model)),
      querySource: 'compact',
    },
  })
}
```

**Pi-mono** (`packages/coding-agent/src/core/compaction/compaction.ts`):

```typescript
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model<any>,
  reserveTokens: number,
  apiKey: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);
  
  // 选择提示词（初始或更新）
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }
  
  // 序列化对话为文本
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);
  
  // 构建提示词
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;
  
  // 直接调用 LLM
  const response = await completeSimple(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    { maxTokens, signal, apiKey, headers }
  );
  
  return response.content.filter(...).join("\n");
}
```

---

## 4. 与 ys-code 对比

### 4.1 触发机制对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **触发公式** | `tokens > window - 33,000` | `tokens > window - 16,384` | 未实现 |
| **输出预留** | 20,000 tokens | 无（reserveTokens 包含） | 未实现 |
| **缓冲空间** | 13,000 tokens | 无明确缓冲 | 未实现 |
| **熔断机制** | 连续 3 次失败后停止 | 无 | 未实现 |
| **递归守卫** | 有（session_memory, compact） | 无明确递归守卫 | 未实现 |
| **特性开关** | GrowthBook 远程配置 | 本地配置文件 | 未实现 |
| **手动触发** | `/compact` 命令 | `/compact` 命令 | 未实现 |

### 4.2 压缩流程对比

| 阶段 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **预处理** | microCompact（可选） | prepareCompaction（必须） | 未实现 |
| **轻量压缩** | Time-based MC + Cached MC | 无 | 未实现 |
| **实验性压缩** | sessionMemoryCompact | 无 | 未实现 |
| **摘要策略** | 全量压缩 | 从上一次压缩边界开始 | 未实现 |
| **摘要生成** | Forked Agent 或 Streaming | 直接 LLM 调用 | 未实现 |
| **迭代摘要** | 不支持 | 支持（UPDATE_SUMMARIZATION_PROMPT） | 未实现 |
| **附件恢复** | 文件、技能、计划、Agent | 仅文件操作追踪 | 未实现 |
| **后处理** | runPostCompactCleanup | SessionManager 追加 CompactionEntry | 未实现 |

### 4.3 消息处理对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **消息模型** | 扁平消息列表 | 树形 Session Entries | 扁平数组 |
| **分组依据** | API 轮次（message.id） | Token 预算 | 未实现 |
| **切割单位** | API 轮次边界 | 消息边界 | 未实现 |
| **Split Turn** | 支持（partialCompact） | 支持（turnPrefixMessages） | 未实现 |
| **保留策略** | 固定 token 预算 | 固定 recent tokens（20K） | 未实现 |
| **工具对保护** | groupMessagesByApiRound | findValidCutPoints 跳过 toolResult | 未实现 |
| **PTL 重试** | 逐组丢弃最旧消息 | 无 | 未实现 |

### 4.4 附件保留对比

| 附件类型 | Claude Code | Pi-mono | ys-code |
|----------|-------------|---------|---------|
| **最近访问文件** | 最多 5 个，每个最多 5K tokens，总计 50K | 累积追踪到 details，无硬限制 | 未实现 |
| **技能** | 按最近调用排序，每个最多 5K tokens，总计 25K | 不追踪 | 未实现 |
| **计划** | 完整保留，无限制 | 不追踪 | 未实现 |
| **异步 Agent** | 状态完整保留，无限制 | 不追踪 | 未实现 |
| **文件操作** | 压缩后重新注入文件附件 | 直接累积到摘要（readFiles/modifiedFiles） | 未实现 |

### 4.5 摘要格式对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **结构** | 9 部分强制结构 | 5 部分强制 + 可选 | 未实现 |
| **格式** | XML 标签 | Markdown | 未实现 |
| **草稿** | 有（`<analysis>`，会被移除） | 无 | 未实现 |
| **文件追踪** | 压缩后重新注入附件 | 直接追加到摘要 | 未实现 |
| **用户消息** | 独立部分（All user messages） | 纳入 Goal/Progress | 未实现 |
| **迭代更新** | 不支持 | 支持（UPDATE_SUMMARIZATION_PROMPT） | 未实现 |

### 4.6 扩展机制对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **Hook 类型** | PreCompact / PostCompact / SessionStart | session_before_compact | 未实现 |
| **返回方式** | 修改上下文（customInstructions） | 取消或自定义结果（compaction 对象） | 未实现 |
| **自定义摘要** | 通过 customInstructions 影响 | 直接返回 summary 对象 | 未实现 |
| **分支支持** | 无 | session_before_tree | 未实现 |

### 4.7 树形会话支持对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **树形结构** | 无（扁平列表） | SessionManager 原生支持 | 未实现 |
| **分支摘要** | 无 | BranchSummaryEntry | 未实现 |
| **摘要累积** | 无 | 跨多个分支累积 | 未实现 |
| **导航触发** | 无 | `/tree` 命令 | 未实现 |
| **partialCompact** | 支持（from / up_to 方向） | 无 | 未实现 |

### 4.8 缓存策略对比

| 方面 | Claude Code | Pi-mono | ys-code |
|------|-------------|---------|---------|
| **缓存复用** | Forked Agent（98% 命中率） | 无 | 未实现 |
| **降级方案** | Regular Streaming | 直接调用 | 未实现 |
| **Thinking** | 禁用 | 可选启用 | 未实现 |
| **工具** | 只读（FileReadTool） | 无 | 未实现 |

---

## 5. 可借鉴点与建议

### 5.1 触发机制建议

> **建议:** [P0] 采用 **Pi-mono 的简单预留模式** 作为 MVP，预留 16K tokens：

```typescript
export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;      // 默认 16384
  keepRecentTokens: number;   // 默认 20000
}
```

> **建议:** [P1] 后续引入 **Claude Code 的多级阈值**（输出预留 + 缓冲），更精细控制触发时机。

> **建议:** [P2] 引入 **熔断机制**（连续 3 次失败后停止），防止不可恢复场景下无限重试。

### 5.2 压缩流程建议

> **建议:** [P0] 采用 **Pi-mono 的全量压缩流程**（prepareCompaction → generateSummary → 追加 CompactionEntry），代码量少，易于理解。

> **建议:** [P1] 后续引入 **Claude Code 的 microCompact** 作为前置轻量压缩，减少全量压缩频率：

```typescript
// Time-based microCompact：距离上条 assistant 消息 > 60 分钟，清除旧 tool results
// Cached microCompact：使用 cache_edits API 编辑缓存，不使缓存失效
```

> **建议:** [P1] 引入 **Claude Code 的 Forked Agent 缓存复用**，显著降低压缩成本。

### 5.3 消息处理建议

> **建议:** [P0] 采用 **Pi-mono 的树形 Session Entries**，原生支持分支和分支摘要。

> **建议:** [P1] 引入 **Claude Code 的 API 轮次分组**（groupMessagesByApiRound），确保 tool_use/tool_result 对不被拆分。

> **建议:** [P2] 引入 **Claude Code 的 PTL 重试机制**，压缩请求本身超长时优雅降级。

### 5.4 附件保留建议

> **建议:** [P1] 采用 **Claude Code 的附件恢复策略**：

| 附件类型 | 预算 | 策略 |
|----------|------|------|
| 最近访问文件 | 50K tokens | 最多 5 个，每个最多 5K tokens |
| 技能 | 25K tokens | 按最近调用排序，每个最多 5K tokens |
| 计划 | 无限制 | 完整保留 |
| 异步 Agent | 无限制 | 状态完整保留 |

> **建议:** [P2] 同时采用 **Pi-mono 的累积文件追踪**，将 readFiles/modifiedFiles 记录到 CompactionEntry details。

### 5.5 摘要格式建议

> **建议:** [P1] 采用 **Pi-mono 的 Markdown 格式**，比 XML 更易读：

```markdown
## Goal
[用户目标]

## Constraints & Preferences
- [约束]

## Progress
### Done
- [x] [已完成]

### In Progress
- [ ] [进行中]

## Key Decisions
- **[决策]**: [理由]

## Next Steps
1. [下一步]

## Critical Context
[关键上下文]
```

> **建议:** [P2] 引入 **Pi-mono 的迭代摘要**（UPDATE_SUMMARIZATION_PROMPT），基于前一个摘要增量更新，保持连贯性。

### 5.6 扩展机制建议

> **建议:** [P2] 采用 **Pi-mono 的 session_before_compact event**，允许扩展完全自定义摘要：

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { readFiles: [], modifiedFiles: [] }
    }
  };
});
```

---

## 6. 参考链接

- **Claude Code 触发器**: `refer/claude-code-haha/src/services/compact/autoCompact.ts`
- **Claude Code 核心压缩**: `refer/claude-code-haha/src/services/compact/compact.ts`
- **Claude Code 微压缩**: `refer/claude-code-haha/src/services/compact/microCompact.ts`
- **Claude Code 消息分组**: `refer/claude-code-haha/src/services/compact/grouping.ts`
- **Pi-mono 压缩核心**: `refer/pi-mono/packages/coding-agent/src/core/compaction/compaction.ts`
- **Pi-mono 分支摘要**: `refer/pi-mono/packages/coding-agent/src/core/compaction/branch-summarization.ts`
- **Pi-mono 工具函数**: `refer/pi-mono/packages/coding-agent/src/core/compaction/utils.ts`
