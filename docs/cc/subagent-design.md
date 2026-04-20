# subAgent 实现方案

> 深入浅出解析 claude-code-haha 源码中的 subAgent 实现

## 1. 概念入门

### 1.1 什么是 subAgent？

subAgent（子代理）是在主会话中启动的独立工作单元。它的核心价值在于：

- **并行执行**：主会话可以同时运行多个 subAgent，处理不同任务
- **上下文隔离**：subAgent 的状态变更不会污染主会话
- **Prompt Cache 复用**：subAgent 可以复用主会话的 prompt cache，节省成本

### 1.2 形象类比

想象主会话是一艘航母，subAgent 是航母上弹射起飞的战斗机：

- **共享跑道（Prompt Cache）**：战斗机复用航母的跑道，不需要自己建
- **独立作战（状态隔离）**：战斗机执行任务时，不会影响航母本身的状态
- **可回收（单向 Abort）**：如果航母需要停止任务，可以命令战斗机返航（Abort），但战斗机坠毁不会影响航母

---

## 2. 核心架构

### 2.1 文件一览

| 文件 | 职责 |
|------|------|
| `utils/forkedAgent.ts` | **核心**：`createSubagentContext()` 和 `runForkedAgent()` |
| `tools/AgentTool/runAgent.ts` | AgentTool 使用上述函数创建 subAgent |
| `query/stopHooks.ts` | 每个 turn 结束时保存 `CacheSafeParams` |
| `utils/abortController.ts` | `createChildAbortController` 实现 Abort 信号传播 |
| `utils/fileStateCache.ts` | `cloneFileStateCache` 实现文件状态克隆 |

### 2.2 两个核心函数

```typescript
// 创建 subAgent 的执行上下文（隔离环境）
createSubagentContext(parentContext, overrides)

// 运行一个 subAgent 的 query 循环
runForkedAgent(params)
```

---

## 3. 消息传递与 Prompt Cache

### 3.1 为什么需要特殊处理？

Anthropic API 的 **Prompt Cache** 机制会根据以下内容生成缓存键：

```
Cache Key = (system prompt) + (tools) + (model) + (messages prefix) + (thinking config)
```

如果 subAgent 想复用父级的 cache，必须保证上述所有内容完全一致。

### 3.2 forkContextMessages 的作用

**问题**：主会话的消息历史很长，每次都传给 subAgent 太浪费。

**解决**：在主会话的**每个 turn 结束时**，把当前消息历史保存起来：

```typescript
// query/stopHooks.ts - 每个 turn 结束后执行
const stopHookContext = {
  messages: [...messagesForQuery, ...assistantMessages],  // 完整消息历史
  systemPrompt,
  userContext,
  systemContext,
  toolUseContext,
  querySource,
}

// 只在主线程保存（subAgent 不覆盖）
if (querySource === 'repl_main_thread' || querySource === 'sdk') {
  saveCacheSafeParams(createCacheSafeParams(stopHookContext))
}
```

### 3.3 subAgent 如何使用

```typescript
// subAgent 启动时
const initialMessages = [...forkContextMessages, ...promptMessages]

// 这确保了：
// 1. 消息前缀与父级完全一致 → Cache Hit
// 2. subAgent 有完整的上下文理解
```

### 3.4 消息继承流程图

```
┌─────────────────────────────────────────────────────────┐
│                      主会话                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Turn 1: User → Assistant → ToolUse → Result     │   │
│  └─────────────────────────────────────────────────┘   │
│                        ↓ turn 结束                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │ handleStopHooks 保存 CacheSafeParams             │   │
│  │   messages = Turn1 的完整消息                    │   │
│  └─────────────────────────────────────────────────┘   │
│                        ↓                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Turn 2: User → Assistant (需要 subAgent?)       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          ↓ 启动 subAgent
┌─────────────────────────────────────────────────────────┐
│                     subAgent                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ initialMessages = [Turn1 消息, Turn2 prompt]   │   │
│  │                                                   │   │
│  │ API 请求的 messages prefix 与父级 Turn2 完全一致  │   │
│  │ → ✅ Prompt Cache Hit                           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 状态隔离机制

### 4.1 为什么要隔离？

subAgent 在执行任务时会产生各种副作用：

- **修改文件**：读写文件可能改变 `readFileState`
- **更新 UI**：调用 `setAppState` 更新应用状态
- **做决策**：`toolDecisions` 记录工具使用决策
- **Abort**：停止当前操作

如果这些副作用影响父级，会导致不可预测的行为。

### 4.2 隔离策略一览

| 状态 | 默认行为 | 说明 |
|------|---------|------|
| `readFileState` | **克隆** | subAgent 看到的是文件状态的副本 |
| `abortController` | **链接到父** | 父 Abort → 子也 Abort，子 Abort 不影响父 |
| `setAppState` | **no-op** | subAgent 的 UI 更新不会影响父 |
| `setResponseLength` | **no-op** | 子不贡献响应指标（除非显式共享） |
| `contentReplacementState` | **克隆** | 确保相同的工具决策 → 相同 wire prefix |
| `queryTracking` | **新 chainId** | 追踪嵌套深度 |

### 4.3 深入：readFileState 克隆

```typescript
// utils/fileStateCache.ts
export function cloneFileStateCache(cache: FileStateCache): FileStateCache {
  const cloned = createFileStateCacheWithSizeLimit(cache.max, cache.maxSize)
  cloned.load(cache.dump())  // 使用 LRUCache 的序列化机制
  return cloned
}
```

**为什么克隆而不是共享？**

场景：subAgent 读取了文件 A，然后父会话也读取文件 A。

- **共享**：第二次读取会命中缓存，但实际上文件可能已被 subAgent 修改
- **克隆**：各自有独立的缓存，互补干扰

### 4.4 深入：AbortController 链接

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

**传播方向**：父 → 子（单向）

**内存安全**：使用 `WeakRef`，废弃的子控制器可被 GC 回收。

### 4.5 深入：contentReplacementState 克隆

这个机制比较隐蔽，但它对 Prompt Cache 至关重要：

```typescript
// 工具结果替换状态 - 记录哪些 tool_use_id 被替换过
type ContentReplacementState = {
  seenIds: Set<string>      // 已处理的 tool_use_id
  replacements: Map<string, string>  // 替换映射
}

// 克隆时创建新容器，但内容相同
cloneContentReplacementState(source): ContentReplacementState {
  return {
    seenIds: new Set(source.seenIds),
    replacements: new Map(source.replacements),
  }
}
```

**为什么重要？**

考虑这个场景：
1. 父会话调用工具 T1，得到结果 R1
2. `contentReplacementState` 记录 R1 被替换为简化版本
3. subAgent 也会调用 T1，需要得到相同的替换结果

如果 subAgent 没有这个状态，它可能做出不同的替换决策 → wire prefix 不同 → Cache Miss

---

## 5. 同步 vs 异步 Agent

### 5.1 两种模式

| 模式 | 场景 | 状态共享 |
|------|------|---------|
| **同步** | 等待结果返回 | 与父级共享 `setAppState`、`abortController` |
| **异步** | 后台运行 | 隔离所有状态 |

### 5.2 代码差异

```typescript
// tools/AgentTool/runAgent.ts

// 决定 abortController
const agentAbortController = override?.abortController
  ? override.abortController
  : isAsync
    ? new AbortController()  // 异步：独立控制器
    : toolUseContext.abortController  // 同步：共享父级

// 决定 setAppState
shareSetAppState: !isAsync  // 同步共享，异步隔离
```

### 5.3 同步 Agent 适用场景

- **AgentTool**：用户等待子代理完成
- **/compact**：压缩会话历史时需要即时反馈

### 5.4 异步 Agent 适用场景

- **Session Memory**：后台提取会话记忆
- **Background Tasks**：后台执行的长期任务

---

## 6. 实际使用示例

### 6.1 Session Memory

```typescript
// services/SessionMemory/sessionMemory.ts
await runForkedAgent({
  promptMessages: [createUserMessage({ content: userPrompt })],
  cacheSafeParams: createCacheSafeParams(context),  // 复用父级 cache
  canUseTool: createMemoryFileCanUseTool(memoryPath),  // 限制工具权限
  querySource: 'session_memory',
  forkLabel: 'session_memory',
})
```

**特点**：
- 完全后台运行，不需要用户交互
- 状态完全隔离，不影响主会话

### 6.2 AgentTool

```typescript
// tools/AgentTool/runAgent.ts
const agentToolUseContext = createSubagentContext(toolUseContext, {
  options: agentOptions,
  agentId,
  agentType: agentDefinition.agentType,
  messages: initialMessages,
  readFileState: agentReadFileState,
  abortController: agentAbortController,
  getAppState: agentGetAppState,
  shareSetAppState: !isAsync,      // 同步共享，异步隔离
  shareSetResponseLength: true,     // 都贡献响应指标
})
```

---

## 7. UI 层集成

### 7.1 SubAgentProvider

```typescript
// components/CtrlOToExpand.tsx
const SubAgentContext = React.createContext(false)

export function SubAgentProvider({ children }) {
  return <SubAgentContext.Provider value={true}>{children}</SubAgentContext.Provider>
}
```

### 7.2 作用

在 `SubAgentContext.Provider` 包裹的内容中，UI 组件会知道自己在 subAgent 的输出中：

```typescript
const isSubAgent = useContext(SubAgentContext)

if (isSubAgent) {
  return null  // subAgent 输出中不显示 "(ctrl+o to expand)" 提示
}
```

---

## 8. 设计决策总结

### 8.1 核心原则

1. **隔离优先**：默认所有可变状态隔离，防止意外污染
2. **Cache 优化**：通过 `CacheSafeParams` 确保 subAgent 复用父级 cache
3. **单向传播**：Abort 信号只能父 → 子，防止子级影响父级
4. **内存安全**：使用 `WeakRef` 避免 AbortController 链接导致的内存泄漏

### 8.2 关键洞察

> **为什么 contentReplacementState 要克隆而不是共享？**

因为 `seenIds` 和 `replacements` 是 `Set` 和 `Map`，如果直接共享引用，subAgent 的修改会影响到父级。克隆后内容相同但引用独立。

> **为什么 setAppState 默认是 no-op？**

subAgent 的 UI 更新应该在 subAgent 自己的输出区域显示，不应该影响父级的 UI 状态。

> **为什么 forkContextMessages 要单独保存而不是从 context 获取？**

因为 context 的 messages 在 query 循环中会被修改，在 turn 结束时保存可以获取完整的消息历史。

---

## 9. 参考

- 核心实现：`refer/claude-code-haha/src/utils/forkedAgent.ts`
- Agent 调用：`refer/claude-code-haha/src/tools/AgentTool/runAgent.ts`
- Query 循环：`refer/claude-code-haha/src/query.ts`
- Stop Hooks：`refer/claude-code-haha/src/query/stopHooks.ts`
