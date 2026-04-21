# Claude Code Compact 系统技术设计文档

## 1. 概述

Compact（上下文压缩）系统是 Claude Code 管理对话上下文长度的核心机制。当对话 Token 数量接近模型上下文窗口限制时，系统通过压缩历史消息为摘要来释放上下文空间。

### 1.1 核心目标

- **上下文空间释放**：将大量历史消息压缩为紧凑摘要
- **关键信息保留**：确保技术细节、代码片段、错误修复等信息不丢失
- **用户体验连续性**：压缩后模型能无缝继续工作

### 1.2 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Compact System Architecture                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │ autoCompact  │───▶│ microCompact     │───▶│ sessionMemory │ │
│  │ (触发器)     │    │ (轻量级清理)      │    │ (实验性)       │ │
│  └──────────────┘    └──────────────────┘    └───────────────┘ │
│         │                   │                      │           │
│         └───────────────────┴──────────────────────┘           │
│                             │                                 │
│                             ▼                                 │
│                    ┌────────────────┐                         │
│                    │compactConversation│                       │
│                    │  (核心压缩引擎)   │                        │
│                    └────────────────┘                         │
│                             │                                 │
│                             ▼                                 │
│                    ┌────────────────┐                         │
│                    │runPostCompact │                         │
│                    │Cleanup        │                         │
│                    │(压缩后清理)     │                        │
│                    └────────────────┘                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 压缩触发机制 (autoCompact.ts)

### 2.1 阈值计算

```typescript
// compact.ts:28-49
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000  // 摘要输出预留

export function getEffectiveContextWindowSize(model: string): number {
  // 1. 获取模型原始上下文窗口
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  // 2. 环境变量覆盖（用于测试）
  if (process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) {
    contextWindow = Math.min(contextWindow, parsed)
  }

  // 3. 减去摘要输出预留
  return contextWindow - Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY
  )
}

// compact.ts:62-65
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000      // 触发缓冲
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000 // 警告缓冲
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000   // 错误缓冲

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS
}
```

### 2.2 触发条件判断

```typescript
// compact.ts:160-239
export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  snipTokensFreed = 0,
): Promise<boolean> {
  // 1. 递归守卫：子 agent 跳过自身压缩
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }

  // 2. CONTEXT_COLLAPSE 模式跳过
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {  // ctx-agent
      return false
    }
    if (isContextCollapseEnabled()) {
      return false
    }
  }

  // 3. REACTIVE_COMPACT 模式可选跳过
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }

  // 4. 检查 autoCompactEnabled 配置
  if (!isAutoCompactEnabled()) {
    return false
  }

  // 5. 计算 token 数量并比较阈值
  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)

  return tokenCount >= threshold
}
```

### 2.3 熔断机制

```typescript
// compact.ts:67-70
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3  // 熔断阈值

// compact.ts:241-351
export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{ wasCompacted: boolean; ... }> {
  // 1. 熔断检查
  if (tracking?.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return { wasCompacted: false }
  }

  // 2. 优先尝试 session memory compaction（更轻量）
  const sessionMemoryResult = await trySessionMemoryCompaction(...)
  if (sessionMemoryResult) {
    return { wasCompacted: true, compactionResult: sessionMemoryResult }
  }

  // 3. 回退到传统压缩
  try {
    const compactionResult = await compactConversation(...)
    return { wasCompacted: true, compactionResult, consecutiveFailures: 0 }
  } catch (error) {
    // 4. 失败时增加计数
    const nextFailures = (tracking?.consecutiveFailures ?? 0) + 1
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
```

### 2.4 警告状态管理

```typescript
// compactWarningState.ts
export const compactWarningStore = createStore<boolean>(false)

export function suppressCompactWarning(): void {
  compactWarningStore.setState(() => true)  // 压缩成功后抑制
}

export function clearCompactWarningSuppression(): void {
  compactWarningStore.setState(() => false)  // 开始新压缩时清除
}
```

---

## 3. 核心压缩流程 (compact.ts)

### 3.1 compactConversation 完整流程

```typescript
// compact.ts:387-763
export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  suppressFollowUpQuestions: boolean,
  customInstructions?: string,
  isAutoCompact: boolean = false,
  recompactionInfo?: RecompactionInfo,
): Promise<CompactionResult> {
  // === Phase 1: Pre-compact ===
  // 1. 执行 PreCompact hooks
  const hookResult = await executePreCompactHooks(...)
  customInstructions = mergeHookInstructions(customInstructions, hookResult.newCustomInstructions)

  // === Phase 2: Generate Summary ===
  // 2. 流式生成摘要（带 PTL 重试）
  for (;;) {
    summaryResponse = await streamCompactSummary({ messages, summaryRequest, ... })
    summary = getAssistantMessageText(summaryResponse)

    // PTL = Prompt Too Long
    if (!summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) break

    // CC-1180: 压缩请求本身超长时，逐组丢弃最旧消息
    ptlAttempts++
    if (ptlAttempts > MAX_PTL_RETRIES) throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)

    messagesToSummarize = truncateHeadForPTLRetry(messagesToSummarize, summaryResponse)
    retryCacheSafeParams = { ...retryCacheSafeParams, forkContextMessages: truncated }
  }

  // === Phase 3: Post-compact Cleanup ===
  // 3. 清理文件缓存
  const preCompactReadFileState = cacheToObject(context.readFileState)
  context.readFileState.clear()
  context.loadedNestedMemoryPaths?.clear()

  // 4. 生成附件（文件、技能、计划等）
  const [fileAttachments, asyncAgentAttachments] = await Promise.all([
    createPostCompactFileAttachments(preCompactReadFileState, context, 5),
    createAsyncAgentAttachmentsIfNeeded(context),
  ])

  // 5. 重新注入工具增量信息
  for (const att of getDeferredToolsDeltaAttachment(...)) { ... }
  for (const att of getAgentListingDeltaAttachment(...)) { ... }
  for (const att of getMcpInstructionsDeltaAttachment(...)) { ... }

  // 6. 执行 SessionStart hooks
  const hookMessages = await processSessionStartHooks('compact', { model })

  // 7. 创建边界标记和摘要消息
  const boundaryMarker = createCompactBoundaryMessage(isAutoCompact ? 'auto' : 'manual', ...)
  const summaryMessages = [createUserMessage({ content: getCompactUserSummaryMessage(...), ... })]

  // === Phase 4: Telemetry ===
  // 8. 记录遥测事件
  logEvent('tengu_compact', { preCompactTokenCount, truePostCompactTokenCount, ... })

  // === Phase 5: Post-compact Hooks ===
  // 9. 执行 PostCompact hooks
  const postCompactHookResult = await executePostCompactHooks(...)

  return {
    boundaryMarker,
    summaryMessages,
    attachments: [...fileAttachments, ...asyncAgentAttachments, ...],
    hookResults: hookMessages,
    userDisplayMessage: combinedMessage,
    ...
  }
}
```

### 3.2 Forked Agent vs Streaming 双路径

```typescript
// compact.ts:1179-1248
async function streamCompactSummary({ messages, summaryRequest, ... }): Promise<AssistantMessage> {
  const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_compact_cache_prefix', true)

  // === 路径 1: Forked Agent（优先尝试）===
  if (promptCacheSharingEnabled) {
    try {
      // 关键：不设置 maxOutputTokens，保持与主对话相同的 thinking config
      const result = await runForkedAgent({
        promptMessages: [summaryRequest],
        cacheSafeParams,  // 复用主对话的 prompt cache key
        canUseTool: createCompactCanUseTool(),  // 禁用工具
        querySource: 'compact',
        forkLabel: 'compact',
        maxTurns: 1,
        skipCacheWrite: true,
        overrides: { abortController: context.abortController },
      })

      if (assistantMsg && !assistantMsg.isApiErrorMessage) {
        // 记录缓存命中率和 token 使用
        logEvent('tengu_compact_cache_sharing_success', { cacheHitRate, ... })
        return assistantMsg
      }
    } catch (error) {
      logEvent('tengu_compact_cache_sharing_fallback', { reason: 'error', ... })
    }
  }

  // === 路径 2: Regular Streaming（降级方案）===
  const streamingGen = queryModelWithStreaming({
    messages: normalizeMessagesForAPI(
      stripImagesFromMessages(stripReinjectedAttachments([...getMessagesAfterCompactBoundary(messages), summaryRequest])),
      context.options.tools
    ),
    systemPrompt: asSystemPrompt(['You are a helpful AI assistant tasked with summarizing conversations.']),
    thinkingConfig: { type: 'disabled' as const },  // 禁用思考
    tools: [FileReadTool],  // 只读工具
    signal: context.abortController.signal,
    options: {
      maxOutputTokensOverride: Math.min(COMPACT_MAX_OUTPUT_TOKENS, getMaxOutputTokensForModel(model)),
      querySource: 'compact',
      ...
    },
  })

  // 流式消费事件...
}
```

### 3.3 Prompt Too Long 重试机制

```typescript
// compact.ts:230-291
export function truncateHeadForPTLRetry(
  messages: Message[],
  ptlResponse: AssistantMessage,
): Message[] | null {
  // 1. 按 API 轮次分组
  const groups = groupMessagesByApiRound(input)

  // 2. 计算需要丢弃的组数
  const tokenGap = getPromptTooLongTokenGap(ptlResponse)
  if (tokenGap !== undefined) {
    // 精确模式：累加直到覆盖 token 缺口
    let acc = 0
    for (const g of groups) {
      acc += roughTokenCountEstimationForMessages(g)
      if (acc >= tokenGap) break
    }
  } else {
    // 回退模式：丢弃 20% 的组
    dropCount = Math.max(1, Math.floor(groups.length * 0.2))
  }

  // 3. 确保第一个消息是 user role
  const sliced = groups.slice(dropCount).flat()
  if (sliced[0]?.type === 'assistant') {
    return [createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }), ...sliced]
  }
  return sliced
}
```

### 3.4 消息预处理

```typescript
// compact.ts:145-200
export function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.type !== 'user') return message

    // 1. 替换顶层 image/document 为 [image]/[document]
    const newContent = content.flatMap(block => {
      if (block.type === 'image') return [{ type: 'text', text: '[image]' }]
      if (block.type === 'document') return [{ type: 'text', text: '[document]' }]

      // 2. 递归处理嵌套在 tool_result 中的 media
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        const newToolContent = block.content.map(item => {
          if (item.type === 'image') return { type: 'text', text: '[image]' }
          if (item.type === 'document') return { type: 'text', text: '[document]' }
          return item
        })
        return [{ ...block, content: newToolContent }]
      }
      return [block]
    })
    return { ...message, message: { ...message.message, content: newContent } }
  })
}

// compact.ts:211-223
export function stripReinjectedAttachments(messages: Message[]): Message[] {
  // 过滤掉 skill_discovery 和 skill_listing 附件
  // 它们会在压缩后通过 resetSentSkillNames() 重新注入
  return messages.filter(m =>
    !(m.type === 'attachment' &&
      (m.attachment.type === 'skill_discovery' || m.attachment.type === 'skill_listing'))
  )
}
```

---

## 4. 微压缩机制 (microCompact.ts)

### 4.1 Time-based Microcompact

```typescript
// microCompact.ts:412-444
export function evaluateTimeBasedTrigger(
  messages: Message[],
  querySource: QuerySource | undefined,
): { gapMinutes: number; config: TimeBasedMCConfig } | null {
  const config = getTimeBasedMCConfig()

  // 只在主线程触发
  if (!config.enabled || !querySource || !isMainThreadSource(querySource)) {
    return null
  }

  // 查找最后一条 assistant 消息
  const lastAssistant = messages.findLast(m => m.type === 'assistant')
  if (!lastAssistant) return null

  // 计算时间间隔
  const gapMinutes = (Date.now() - new Date(lastAssistant.timestamp).getTime()) / 60_000
  if (gapMinutes < config.gapThresholdMinutes) return null

  return { gapMinutes, config }
}

// microCompact.ts:446-530
function maybeTimeBasedMicrocompact(messages: Message[], querySource: QuerySource | undefined): MicrocompactResult | null {
  const trigger = evaluateTimeBasedTrigger(messages, querySource)
  if (!trigger) return null

  const { gapMinutes, config } = trigger
  const compactableIds = collectCompactableToolIds(messages)

  // 保留最近 N 个可压缩工具的结果
  const keepRecent = Math.max(1, config.keepRecent)
  const keepSet = new Set(compactableIds.slice(-keepRecent))
  const clearSet = new Set(compactableIds.filter(id => !keepSet.has(id)))

  // 替换清除工具结果为空字符串标记
  const result: Message[] = messages.map(message => {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      return message
    }
    const newContent = message.message.content.map(block => {
      if (block.type === 'tool_result' && clearSet.has(block.tool_use_id)) {
        return { ...block, content: TIME_BASED_MC_CLEARED_MESSAGE }
      }
      return block
    })
    return { ...message, message: { ...message.message, content: newContent } }
  })

  logEvent('tengu_time_based_microcompact', { gapMinutes, toolsCleared: clearSet.size, ... })
  return { messages: result }
}
```

### 4.2 Cached Microcompact

```typescript
// microCompact.ts:305-399
async function cachedMicrocompactPath(
  messages: Message[],
  querySource: QuerySource | undefined,
): Promise<MicrocompactResult> {
  const mod = await getCachedMCModule()
  const state = ensureCachedMCState()
  const config = mod.getCachedMCConfig()

  // 1. 收集可压缩的工具 ID
  const compactableToolIds = new Set(collectCompactableToolIds(messages))

  // 2. 注册工具结果
  for (const message of messages) {
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === 'tool_result' && compactableToolIds.has(block.tool_use_id)) {
          mod.registerToolResult(state, block.tool_use_id)
        }
      }
    }
  }

  // 3. 获取需要删除的工具
  const toolsToDelete = mod.getToolResultsToDelete(state)

  if (toolsToDelete.length > 0) {
    // 4. 创建 cache_edits 块供 API 层使用
    const cacheEdits = mod.createCacheEditsBlock(state, toolsToDelete)
    pendingCacheEdits = cacheEdits

    // 5. 注意：消息内容不修改，cache_edits 由 API 层添加
    return {
      messages,  // 消息保持不变
      compactionInfo: {
        pendingCacheEdits: {
          trigger: 'auto',
          deletedToolIds: toolsToDelete,
          baselineCacheDeletedTokens: baseline,
        },
      },
    }
  }

  return { messages }
}
```

### 4.3 可压缩工具列表

```typescript
// microCompact.ts:40-50
const COMPACTABLE_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  ...SHELL_TOOL_NAMES,        // Bash, etc.
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])

// 注意：这些工具的结果可以被清除或编辑
// 其他工具（如 TaskTool, AgentTool）不可压缩
```

---

## 5. 会话记忆压缩 (sessionMemoryCompact.ts)

### 5.1 消息保留策略

```typescript
// sessionMemoryCompact.ts:324-397
export function calculateMessagesToKeepIndex(
  messages: Message[],
  lastSummarizedIndex: number,
): number {
  const config = getSessionMemoryCompactConfig()

  // 从 lastSummarizedIndex 之后开始
  let startIndex = lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : messages.length

  // 计算当前 tokens 和消息数
  let totalTokens = 0
  let textBlockMessageCount = 0
  for (let i = startIndex; i < messages.length; i++) {
    totalTokens += estimateMessageTokens([messages[i]])
    if (hasTextBlocks(messages[i])) {
      textBlockMessageCount++
    }
  }

  // 向前扩展直到满足最小要求
  const idx = messages.findLastIndex(m => isCompactBoundaryMessage(m))
  const floor = idx === -1 ? 0 : idx + 1  // 不能越过旧的 compact boundary

  for (let i = startIndex - 1; i >= floor; i--) {
    startIndex = i
    totalTokens += estimateMessageTokens([messages[i]])
    if (hasTextBlocks(messages[i])) textBlockMessageCount++

    if (totalTokens >= config.maxTokens) break
    if (totalTokens >= config.minTokens && textBlockMessageCount >= config.minTextBlockMessages) break
  }

  // 调整以保持 tool_use/tool_result 对完整
  return adjustIndexToPreserveAPIInvariants(messages, startIndex)
}
```

### 5.2 API 不变量保护

```typescript
// sessionMemoryCompact.ts:232-314
export function adjustIndexToPreserveAPIInvariants(
  messages: Message[],
  startIndex: number,
): number {
  let adjustedIndex = startIndex

  // 1. 处理 tool_use/tool_result 对
  // 确保保留消息中的 tool_result 引用的 tool_use 也在保留范围内
  const allToolResultIds: string[] = []
  for (let i = startIndex; i < messages.length; i++) {
    allToolResultIds.push(...getToolResultIds(messages[i]))
  }

  if (allToolResultIds.length > 0) {
    const neededToolUseIds = new Set(
      allToolResultIds.filter(id => !toolUseIdsInKeptRange.has(id))
    )

    // 向后查找需要的 tool_use
    for (let i = adjustedIndex - 1; i >= 0 && neededToolUseIds.size > 0; i--) {
      if (hasToolUseWithIds(messages[i], neededToolUseIds)) {
        adjustedIndex = i
        // 移除已找到的
        for (const block of messages[i].message.content) {
          if (block.type === 'tool_use') neededToolUseIds.delete(block.id)
        }
      }
    }
  }

  // 2. 处理 thinking 块
  // 确保相同 message.id 的 thinking 块被保留
  const messageIdsInKeptRange = new Set<string>()
  for (let i = startIndex; i < messages.length; i++) {
    if (messages[i].type === 'assistant') {
      messageIdsInKeptRange.add(messages[i].message.id)
    }
  }

  // 向后查找共享 message.id 的 assistant 消息
  for (let i = adjustedIndex - 1; i >= 0; i--) {
    if (message.type === 'assistant' && messageIdsInKeptRange.has(message.message.id)) {
      adjustedIndex = i
    }
  }

  return adjustedIndex
}
```

### 5.3 配置管理

```typescript
// sessionMemoryCompact.ts:44-96
export type SessionMemoryCompactConfig = {
  minTokens: number           // 最小保留 tokens（默认 10,000）
  minTextBlockMessages: number // 最小文本消息数（默认 5）
  maxTokens: number           // 最大保留 tokens（默认 40,000）
}

export const DEFAULT_SM_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
}

// 从 GrowthBook 远程配置覆盖
async function initSessionMemoryCompactConfig(): Promise<void> {
  const remoteConfig = await getDynamicConfig_BLOCKS_ON_INIT<Partial<SessionMemoryCompactConfig>>(
    'tengu_sm_compact_config',
    {}
  )
  // 只使用正数值，默认值作为 fallback
  smCompactConfig = {
    minTokens: remoteConfig.minTokens && remoteConfig.minTokens > 0 ? remoteConfig.minTokens : DEFAULT.minTokens,
    ...
  }
}
```

---

## 6. 压缩后清理 (postCompactCleanup.ts)

### 6.1 清理清单

```typescript
// postCompactCleanup.ts:31-77
export function runPostCompactCleanup(querySource?: QuerySource): void {
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk'

  // 1. 重置微压缩状态（所有压缩路径都需要）
  resetMicrocompactState()

  // 2. Context collapse 状态（仅主线程）
  if (feature('CONTEXT_COLLAPSE') && isMainThreadCompact) {
    require('../contextCollapse/index.js').resetContextCollapse()
  }

  // 3. 用户上下文缓存（仅主线程）
  if (isMainThreadCompact) {
    getUserContext.cache.clear()
    resetGetMemoryFilesCache('compact')
  }

  // 4. 系统提示词节
  clearSystemPromptSections()

  // 5. 分类器状态
  clearClassifierApprovals()
  clearSpeculativeChecks()

  // 6. Beta 追踪状态
  clearBetaTracingState()

  // 7. Session 消息缓存
  clearSessionMessagesCache()

  // === 不清理的内容 ===
  // - invoked skill content: 跨多次压缩保持
  // - sentSkillNames: 重新注入 skill_listing 是纯缓存创建
}
```

---

## 7. 压缩提示词 (prompt.ts)

### 7.1 全量压缩提示词

```typescript
// prompt.ts:293-303
export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT

  // 添加自定义指令
  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += NO_TOOLS_TRAILER
  return prompt
}

// prompt.ts:19-26
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
`
```

### 7.2 摘要格式

```typescript
// prompt.ts:61-143
// 摘要必须包含 9 个部分：
// 1. Primary Request and Intent
// 2. Key Technical Concepts
// 3. Files and Code Sections
// 4. Errors and fixes
// 5. Problem Solving
// 6. All user messages
// 7. Pending Tasks
// 8. Current Work
// 9. Optional Next Step
```

### 7.3 格式化

```typescript
// prompt.ts:311-335
export function formatCompactSummary(summary: string): string {
  let formatted = summary

  // 移除 <analysis> 草稿部分
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, '')

  // 将 <summary> 转换为可读格式
  const summaryMatch = formatted.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) {
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${summaryMatch[1].trim()}`
    )
  }

  // 清理多余空行
  formatted = formatted.replace(/\n\n+/g, '\n\n')
  return formatted.trim()
}
```

---

## 8. 关键设计决策

### 8.1 缓存复用策略

| 策略 | 优势 | 劣势 | 选择 |
|------|------|------|------|
| Forked Agent | 98% 缓存命中率 | 需保持 thinking config 一致 | 默认 |
| Regular Streaming | 无缓存依赖 | 98% 缓存未命中 | 降级方案 |

### 8.2 熔断机制

- 连续 3 次压缩失败后停止自动压缩
- 防止在不可恢复的上下文超限情况下浪费 API 调用
- 手动 `/compact` 不受熔断限制

### 8.3 附件保留策略

| 附件类型 | 保留策略 | 预算 |
|----------|----------|------|
| 最近访问文件 | 最多 5 个，每个最多 5K tokens | 50K 总计 |
| 技能 | 按最近调用排序，每个最多 5K tokens | 25K 总计 |
| 计划 | 完整保留 | 无限制 |
| 异步 Agent | 状态完整保留 | 无限制 |

### 8.4 消息分组策略

- `groupMessagesByApiRound()`：按 `message.id` 变化边界分组
- 确保 tool_use/tool_result 对不被拆分
- 用于 reactive compact 的尾部处理

---

## 9. 事件与遥测

### 9.1 核心事件

| 事件名 | 触发时机 | 关键指标 |
|--------|----------|----------|
| `tengu_compact` | 压缩完成 | preCompactTokenCount, truePostCompactTokenCount, cacheHitRate |
| `tengu_compact_cache_sharing_success` | Forked agent 成功 | cacheHitRate, outputTokens |
| `tengu_compact_cache_sharing_fallback` | 降级到 streaming | reason |
| `tengu_compact_ptl_retry` | PTL 重试 | attempt, droppedMessages |
| `tengu_compact_failed` | 压缩失败 | reason, preCompactTokenCount |
| `tengu_time_based_microcompact` | 时间触发微压缩 | gapMinutes, toolsCleared |
| `tengu_sm_compact_*` | 会话记忆压缩 | 各阶段状态 |

---

## 10. 文件清单

```
src/services/compact/
├── compact.ts                    # 核心压缩引擎 (~1700 行)
├── autoCompact.ts               # 自动压缩触发器 (~350 行)
├── microCompact.ts              # 微压缩 (~530 行)
├── sessionMemoryCompact.ts      # 会话记忆压缩 (~630 行)
├── prompt.ts                    # 提示词模板 (~375 行)
├── grouping.ts                  # 消息分组 (~63 行)
├── postCompactCleanup.ts        # 压缩后清理 (~77 行)
├── compactWarningState.ts       # 警告状态 (~18 行)
├── compactWarningHook.ts       # React hook (~16 行)
├── timeBasedMCConfig.ts         # 时间触发配置 (~43 行)
└── apiMicrocompact.ts           # API 侧上下文管理 (~153 行)
```

---

## 11. 相关配置

### 11.1 环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `DISABLE_COMPACT` | 禁用所有压缩 | - |
| `DISABLE_AUTO_COMPACT` | 禁用自动压缩 | - |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | 覆盖自动压缩窗口 | - |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 按百分比覆盖阈值 | - |
| `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` | 覆盖阻塞限制 | - |

### 11.2 GrowthBook 配置

| 键 | 作用 | 默认值 |
|----|------|--------|
| `tengu_compact_cache_prefix` | 启用 forked agent 缓存复用 | true |
| `tengu_compact_streaming_retry` | 启用 streaming 重试 | false |
| `tengu_slate_heron` | 时间触发微压缩配置 | { enabled: false, gapThresholdMinutes: 60, keepRecent: 5 } |
| `tengu_sm_compact_config` | 会话记忆压缩配置 | { minTokens: 10k, minTextBlockMessages: 5, maxTokens: 40k } |
| `tengu_cobalt_raccoon` | REACTIVE_COMPACT 模式跳过 | false |
