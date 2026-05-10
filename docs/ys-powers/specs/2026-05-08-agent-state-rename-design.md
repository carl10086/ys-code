# Agent 状态层重构设计文档

## 1. 目标 (Objective)

消除 `AgentContext`、`LoopState`、`AgentState` 三个类型的命名模糊和职责重叠，建立清晰的状态分层：

- **输入层**：`AgentInput`（原 `AgentContext`）—— 启动 Agent 的纯配置，不含 `messages`
- **运行时层**：`LoopState` —— 循环内部的唯一状态持有者，包含 `messages` 和轮次临时状态（保留在 `agent-loop.ts` 内部，不导出）
- **视图层**：`AgentView`（原 `AgentState`）—— 外部只读观察接口，供 TUI 渲染

同时消除 `streamAssistantResponse` 对 `messages` 数组的副作用（mutate），使其成为纯函数。

## 2. 背景与问题分析

### 2.1 当前问题

| 问题 | 现状 | 影响 |
|------|------|------|
| 命名模糊 | `AgentContext` 既像"配置"又像"状态" | 调用者不清楚是否可以修改 |
| 职责重叠 | `AgentContext` 含 `messages`，但 loop 启动后就复制到 `LoopState` | `messages` 存在两个"所有者" |
| 副作用隐蔽 | `streamAssistantResponse` 直接 `push` 到 `context.messages` | 数据流不可追踪，测试困难 |
| 类型引用绕 | `LoopState` 用 `AgentContext["tools"]` 声明字段 | 阅读时需跳转，增加认知负担 |

### 2.2 参考：cc 源码的设计

claude-code-haha 的 `query.ts` 采用完全 immutable 的 state 更新：

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  ...
}

// 每轮迭代构建新 State
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  ...
}
state = next
```

**原则**：没有任何函数会 mutate `state.messages`，所有更新由 loop 统一控制。

## 3. 设计原则

1. **单一持有者**：`messages` 数组只由 `LoopState` 持有，任何函数不直接修改它
2. **无副作用**：`streamAssistantResponse` 接收只读状态，返回结果，由 loop 决定如何更新
3. **命名即文档**：类型名直接表达可见性和生命周期
4. **最小知识**：函数只接收自己需要的字段，不暴露完整的内部状态

## 4. 类型重构方案

### 4.1 新类型定义

```typescript
// types.ts

/** Agent 启动输入（纯配置，不含运行时状态） */
export interface AgentInput {
  tools?: AgentTool<any, any>[];
  sentSkillNames?: Set<string>;
  invokedSkills?: Map<string, InvokedSkillRecord>;
}

/** Agent 运行时快照（供 stream-assistant / tool-execution 使用） */
export interface AgentRuntime {
  messages: AgentMessage[];
  tools?: AgentTool<any, any>[];
  sentSkillNames?: Set<string>;
  invokedSkills?: Map<string, InvokedSkillRecord>;
}

/** Agent 循环运行时状态（保留在 agent-loop.ts 内部） */
interface LoopState extends AgentRuntime {
  pendingToolNewMessages: AgentMessage[];
  pendingSteering: AgentMessage[];
  turnCount: number;
}

/** Agent 公开视图（供 TUI 读取的只读状态） */
export interface AgentView {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any, any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
  sentSkillNames?: Set<string>;
  invokedSkills?: Map<string, InvokedSkillRecord>;
}
```

### 4.2 类型关系图

```
AgentInput ──→ runAgentLoop() ──→ LoopState ──→ agent-loop 内部迭代
                                    │
                                    ├─→ AgentRuntime ──→ streamAssistantResponse (只读)
                                    ├─→ AgentRuntime ──→ executeToolCalls (只读)
                                    │
                                    ↓
Agent 事件流 ──→ AgentView (只读快照)
```

## 5. 函数签名变更

### 5.1 agent-loop.ts

```typescript
// 启动新循环
export async function runAgentLoop(
  messages: AgentMessage[],      // ← 新增：初始消息列表
  prompts: AgentMessage[],
  input: AgentInput,             // ← 原 AgentContext，不含 messages
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<void>;

// 继续已有循环
export async function runAgentLoopContinue(
  messages: AgentMessage[],      // ← 新增：当前消息列表
  input: AgentInput,             // ← 原 AgentContext，不含 messages
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<void>;
```

### 5.2 stream-assistant.ts

```typescript
// 改造为纯函数：接收 AgentRuntime（只读），返回 assistant message
export async function streamAssistantResponse(
  runtime: AgentRuntime,         // ← 原 AgentContext，但不再 mutate
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage>;
```

**关键变更**：
- 不再 `push`/`replace` `runtime.messages`
- stream 过程中只 emit 事件，不修改状态
- `finalizeStreamMessage` 只 emit `message_start`/`message_end`，不操作数组
- 附件生成改为显式传入 `messages` 和 `sentSkillNames`

**附件进入 messages 的路径**（显式化）：
```
generateAttachments(messages, sentSkillNames) → attachments[]
  → saveAttachments(attachments, emit)
  → emit message_start / message_end
  → Agent 事件处理器接收
  → Agent 将附件 push 到 this._state.messages
  → LoopState.messages 同步可见（引用共享）
```

### 5.3 tool-execution.ts

```typescript
// 接收 AgentRuntime 替代 AgentContext
export async function executeToolCalls(
  runtime: AgentRuntime,         // ← 原 AgentContext
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ toolResults: ToolResultMessage[]; newMessages: AgentMessage[] }>;
```

### 5.4 agent.ts

```typescript
// 内部可变状态类型重命名
type MutableAgentView = Omit<AgentView, "systemPrompt" | "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

// 构造函数初始状态参数
initialState?: Partial<Omit<AgentView, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;

// 公开 getter
get state(): AgentView { return this._state; }

// 系统提示词构建函数
public systemPrompt: (input: AgentInput) => Promise<SystemPrompt>;

// 创建上下文快照（供外部调用）
private createInputSnapshot(): AgentInput {
  return {
    tools: this._state.tools,
    sentSkillNames: this._state.sentSkillNames,
    invokedSkills: this._state.invokedSkills,
  };
}
```

## 6. 数据流重构

### 6.1 当前数据流（有副作用）

```
runAgentLoop()
  ├─→ LoopState.messages = [...context.messages, ...prompts]
  ├─→ streamAssistantResponse()
  │     ├─→ context.messages.push(partialMessage)      // ← 副作用！
  │     └─→ context.messages[...] = finalMessage       // ← 副作用！
  └─→ executeToolCalls()
        └─→ messages.push(toolResults)                 // 在 loop 中执行
```

### 6.2 目标数据流（无副作用）

```
runAgentLoop()
  ├─→ LoopState.messages = [...messages, ...prompts]
  ├─→ assistantMessage = streamAssistantResponse(state)  // ← 只读，返回结果
  ├─→ state.messages = [...state.messages, assistantMessage]  // ← loop 统一更新
  ├─→ { toolResults } = executeToolCalls(state)          // ← 只读
  └─→ state.messages = [...state.messages, ...toolResults]    // ← loop 统一更新
```

## 7. 代码风格

- 所有类型字段直接声明，不使用 `AgentContext["tools"]` 等间接引用
- `LoopState` 更新统一使用 `state = { ...state, field: newValue }`
- 函数参数优先使用具体类型（`LoopState`），避免 `any`
- 事件发射和状态更新保持分离

## 8. 测试策略

### 8.1 需要更新的测试文件

| 文件 | 变更内容 |
|------|----------|
| `agent-loop.test.ts` | `AgentContext` → `AgentInput`，传入 `messages` 作为独立参数 |
| `tool-execution.test.ts` | `AgentContext` → `LoopState`，`LoopState` 需补全 `pending*` 和 `turnCount` |
| `stream-assistant.test.ts` | 验证 `streamAssistantResponse` 不再 mutate 输入数组 |
| `skill.test.ts` | 无变更（不依赖被修改的类型） |
| `agent.test.ts` | `AgentState` → `AgentView`，`get state()` 返回类型 |

### 8.2 新增测试场景

1. **无副作用验证**：`streamAssistantResponse` 调用前后，输入的 `messages` 数组长度和内容不变
2. **状态更新顺序**：验证 `agent-loop` 在 `streamAssistantResponse` 返回后才更新 `messages`
3. **附件事件**：`saveAttachments` 发射的事件被正确处理，attachment 消息最终被加入 `LoopState.messages`

## 9. 边界与风险

### 9.1 边界

- **不修改核心 AI 层**：`streamSimple` 和 LLM 相关类型保持不变
- **不修改命令系统**：`commands/types.ts` 和 skill 相关逻辑不涉及
- **不修改 TUI 渲染**：`AgentView` 的字段和 `AgentState` 保持一致，TUI 代码只需改类型名
- **不引入新依赖**：纯重构，无新包

### 9.2 影响范围评估

| 文件 | 影响类型 | 变更量级 |
|------|---------|---------|
| `src/agent/types.ts` | 核心类型定义 | 中 |
| `src/agent/agent-loop.ts` | 函数签名 + LoopState 内部化 | 中 |
| `src/agent/stream-assistant.ts` | 去副作用化 + 签名变更 | **高** |
| `src/agent/tool-execution.ts` | 签名变更（AgentContext → AgentRuntime） | 低 |
| `src/agent/agent.ts` | 类型引用 + 辅助方法重命名 | 中 |
| `src/agent/agent-loop.test.ts` | 测试数据结构调整 | 中 |
| `src/agent/tool-execution.test.ts` | Mock 数据结构调整 | 低 |
| `src/agent/stream-assistant.test.ts` | 新增无副作用断言 | 中 |
| `src/agent/agent.test.ts` | 类型名替换 | 低 |
| `src/session/*.ts` | 需确认是否调用 `runAgentLoop` | 待查 |

### 9.3 风险

| 风险 | 缓解措施 |
|------|----------|
| `streamAssistantResponse` 改造引入事件顺序 bug | 保留现有事件发射逻辑，仅移除 `messages.push` |
| `AgentView` 改名导致 TUI 编译错误 | 全局搜索替换 `AgentState` → `AgentView` |
| 测试 mock 数据需要补全 LoopState 字段 | 创建 `createMockLoopState` 辅助函数 |
| 回滚困难 | 分 commit：先重命名类型，再改结构，最后去副作用 |

## 10. 实施步骤

```
Step 1: 类型重命名（低风险）
  - types.ts: AgentContext → AgentInput, AgentState → AgentView
  - 全局搜索替换导入和引用
  - 运行测试，确保通过

Step 2: LoopState 导出（低风险）
  - 将 LoopState 从 agent-loop.ts 移到 types.ts
  - 修改字段声明方式（去掉 AgentContext["xxx"]）
  - 更新 agent-loop.ts 导入

Step 3: 函数签名调整（中风险）
  - agent-loop.ts: runAgentLoop/runAgentLoopContinue 接收独立 messages 参数
  - tool-execution.ts: AgentContext → LoopState
  - stream-assistant.ts: AgentContext → LoopState
  - 更新所有调用点

Step 4: 去副作用化（高风险）
  - stream-assistant.ts: 移除所有 messages.push / messages[...] = ...
  - agent-loop.ts: 在 streamAssistantResponse 返回后统一更新 state.messages
  - 更新测试预期

Step 5: 验证
  - 全量测试通过
  - TypeScript 编译无错误
  - 手动走查关键路径
```

---

**决策记录**：
- 保留 `LoopState` 名称，因其准确表达"循环运行时状态"
- `AgentInput` 去掉 `messages`，明确区分"配置输入"和"状态数据"
- `streamAssistantResponse` 的附件生成仍依赖 `messages` 内容（扫描 @mention），改为显式传入 `messages` 数组
- 采用**分层无副作用**：函数层（`streamAssistantResponse` / `executeToolCalls`）保证纯函数，loop 层允许可控的 `state` mutation。这比"完全函数式"更符合当前架构，且改造成本可控
