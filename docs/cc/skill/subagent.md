# SubAgent 机制分析

## 1. 背景与定位

SubAgent（子代理）是在主会话中启动的独立工作单元。其核心价值在于：

1. **并行执行**：主会话可以同时运行多个 subAgent，处理不同任务
2. **上下文隔离**：subAgent 的状态变更不会污染主会话
3. **Prompt Cache 复用**：subAgent 可以复用主会话的 prompt cache，节省 API 成本

形象类比：主会话是航母，subAgent 是弹射起飞的战斗机——共享跑道（Prompt Cache）、独立作战（状态隔离）、可回收（单向 Abort）。

> **ys-code 现状:** 已复刻 `createSubagentContext()` 和 `runForkedAgent()` 核心函数，支持同步/异步两种模式，状态隔离策略对齐。

---

## 2. 核心原理

### 两个核心函数

```typescript
// 创建 subAgent 的执行上下文（隔离环境）
createSubagentContext(parentContext, overrides)

// 运行一个 subAgent 的 query 循环
runForkedAgent(params)
```

### Prompt Cache 复用机制

Anthropic API 的 Prompt Cache 键由以下因素决定：

```
Cache Key = (system prompt) + (tools) + (model) + (messages prefix) + (thinking config)
```

subAgent 要复用父级 cache，必须保证上述内容完全一致。解决方案：

1. **主会话每个 turn 结束时**保存 `CacheSafeParams`（含完整消息历史）
2. **subAgent 启动时**将保存的消息作为 `initialMessages` 前缀
3. 这样 subAgent 的 API 请求与父级具有相同的 messages prefix → Cache Hit

```typescript
// query/stopHooks.ts - 每个 turn 结束后执行
const stopHookContext = {
  messages: [...messagesForQuery, ...assistantMessages],
  systemPrompt,
  userContext,
  systemContext,
  toolUseContext,
  querySource,
}

// 只在主线程保存
if (querySource === 'repl_main_thread' || querySource === 'sdk') {
  saveCacheSafeParams(createCacheSafeParams(stopHookContext))
}

// subAgent 启动时
const initialMessages = [...forkContextMessages, ...promptMessages]
```

---

## 3. 源码实现

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/utils/forkedAgent.ts` | 核心：`createSubagentContext()` 和 `runForkedAgent()` |
| `src/tools/AgentTool/runAgent.ts` | AgentTool 使用上述函数创建 subAgent |
| `src/query/stopHooks.ts` | 每个 turn 结束时保存 `CacheSafeParams` |
| `src/utils/abortController.ts` | `createChildAbortController` 实现 Abort 信号传播 |
| `src/utils/fileStateCache.ts` | `cloneFileStateCache` 实现文件状态克隆 |

### 状态隔离策略

| 状态 | 默认行为 | 说明 |
|------|---------|------|
| `readFileState` | **克隆** | subAgent 看到的是文件状态的副本 |
| `abortController` | **链接到父** | 父 Abort → 子也 Abort，子 Abort 不影响父 |
| `setAppState` | **no-op** | subAgent 的 UI 更新不会影响父 |
| `setResponseLength` | **no-op** | 子不贡献响应指标（除非显式共享） |
| `contentReplacementState` | **克隆** | 确保相同的工具决策 → 相同 wire prefix |
| `queryTracking` | **新 chainId** | 追踪嵌套深度 |

### readFileState 克隆

```typescript
// utils/fileStateCache.ts
export function cloneFileStateCache(cache: FileStateCache): FileStateCache {
  const cloned = createFileStateCacheWithSizeLimit(cache.max, cache.maxSize)
  cloned.load(cache.dump())  // 使用 LRUCache 的序列化机制
  return cloned
}
```

**为什么克隆而不是共享？**
- 共享：subAgent 修改文件后，父会话读取会命中过期缓存
- 克隆：各自独立缓存，互不干扰

### AbortController 链接

```typescript
// utils/abortController.ts
export function createChildAbortController(parent: AbortController): AbortController {
  const child = createAbortController()

  // 父 Abort → 自动触发子的 Abort
  const handler = () => child.abort(parent.signal.reason)
  parent.signal.addEventListener('abort', handler, { once: true })

  // 使用 WeakRef 避免内存泄漏
  const weakChild = new WeakRef(child)

  return child
}
```

- **传播方向**：父 → 子（单向）
- **内存安全**：`WeakRef` 确保废弃的子控制器可被 GC 回收

### contentReplacementState 克隆

```typescript
type ContentReplacementState = {
  seenIds: Set<string>      // 已处理的 tool_use_id
  replacements: Map<string, string>  // 替换映射
}

cloneContentReplacementState(source): ContentReplacementState {
  return {
    seenIds: new Set(source.seenIds),
    replacements: new Map(source.replacements),
  }
}
```

**为什么重要？** 如果 subAgent 做出不同的替换决策，wire prefix 会不同 → Cache Miss。

---

## 4. 与 ys-code 对比

| cc 模块/功能 | ys-code 当前实现 | 状态 | 差异说明 |
|-------------|-----------------|------|---------|
| `createSubagentContext()` | `createSubagentContext()` | 已对齐 | 核心函数复刻 |
| `runForkedAgent()` | `runForkedAgent()` | 已对齐 | query 循环逻辑一致 |
| `CacheSafeParams` | `CacheSafeParams` | 已对齐 | 结构一致 |
| `forkContextMessages` | `forkContextMessages` | 已对齐 | 消息继承机制一致 |
| `readFileState` 克隆 | `cloneFileStateCache()` | 已对齐 | LRUCache 序列化机制一致 |
| `abortController` 链接 | `createChildAbortController()` | 已对齐 | WeakRef + 单向传播 |
| `setAppState` no-op | `setAppState` no-op | 已对齐 | 默认隔离 |
| `contentReplacementState` 克隆 | `cloneContentReplacementState()` | 已对齐 | Set/Map 深拷贝 |
| 同步 Agent 模式 | 同步 Agent 模式 | 已对齐 | 共享 abortController |
| 异步 Agent 模式 | 异步 Agent 模式 | 已对齐 | 独立 abortController |
| Session Memory subAgent | 无 | 未实现 | 无后台记忆提取 |
| `SubAgentProvider` UI 隔离 | 无 | 未实现 | 无 React context 隔离 |
| AgentTool 权限限制 | 简化版 | 已简化 | `canUseTool` 逻辑较简单 |

---

## 5. 可借鉴点与建议

> **建议:** [P1] **Session Memory 后台提取**
> 
> cc 使用异步 subAgent 在后台提取会话记忆，不影响主会话交互。ys-code 当前无此机制。建议引入 `session_memory` querySource，支持后台记忆持久化。

> **建议:** [P2] **SubAgentProvider UI 隔离**
> 
> cc 通过 React Context (`SubAgentContext`) 让 UI 组件感知是否在 subAgent 输出中，从而隐藏不必要的提示（如 "ctrl+o to expand"）。ys-code 使用 Ink，建议引入类似的 context 机制。

> **建议:** [P2] **AgentTool 权限精细化**
> 
> cc 的 `canUseTool` 支持按 agent 类型限制可用工具集（如 memory agent 只能读写 memory 目录）。ys-code 当前权限控制较粗。建议引入 agent 类型级别的工具白名单。

> **建议:** [P0] **Abort 信号单向传播**
> 
> 已对齐的 `createChildAbortController` 实现确保了父 → 子的单向传播。这是防止子级异常影响父级的关键设计，必须保持。

---

## 6. 参考链接

- **核心实现**：`refer/claude-code-haha/src/utils/forkedAgent.ts`
- **Agent 调用**：`refer/claude-code-haha/src/tools/AgentTool/runAgent.ts`
- **Query 循环**：`refer/claude-code-haha/src/query.ts`
- **Stop Hooks**：`refer/claude-code-haha/src/query/stopHooks.ts`
- **Abort 控制器**：`refer/claude-code-haha/src/utils/abortController.ts`
- **文件状态缓存**：`refer/claude-code-haha/src/utils/fileStateCache.ts`
