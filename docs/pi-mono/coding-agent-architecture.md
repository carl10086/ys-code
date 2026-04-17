# pi-mono Coding Agent 架构分析

## 1. 架构概述

pi-mono 的 coding-agent 是一个在通用 Agent 框架之上构建的 coding 专用层。它利用分层设计实现了高度的可扩展性和模块化。

```
┌─────────────────────────────────────────────────────────────────┐
│                        coding-agent                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   AgentSession                            │   │
│  │  - Session 持久化 / 分支管理                              │   │
│  │  - 工具注册表（动态启停）                                 │   │
│  │  - 扩展系统集成                                          │   │
│  │  - 上下文压缩（Compaction）                               │   │
│  │  - 自动重试                                              │   │
│  │  - Bash 执行                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Agent                               │   │
│  │  - 状态管理                                             │   │
│  │  - 事件订阅                                             │   │
│  │  - 消息队列（steer/followUp）                           │   │
│  │  - 循环执行（AgentLoop）                                 │   │
│  │  - 工具执行 hooks                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AI Layer                              │   │
│  │  (pi-ai - 多 Provider 支持，Streaming，Thinking 等)       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 核心组件

### 2.1 Agent（底层框架）

位于 `packages/agent/src/`，是通用 Agent 运行时：

- **`Agent`** - 状态封装类，管理循环执行
- **`AgentLoop`** - 核心循环，处理 streaming、tool call 执行
- **Hooks** - `beforeToolCall` / `afterToolCall` 扩展点

```typescript
// Agent 的核心接口
interface AgentOptions {
  initialState?: Partial<AgentState>;
  convertToLlm?: (messages: AgentMessage[]) => Message[];
  transformContext?: (messages: AgentMessage[]) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => string | Promise<string>;
  beforeToolCall?: (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext) => Promise<AfterToolCallResult | undefined>;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}
```

### 2.2 AgentSession（高层封装）

位于 `packages/coding-agent/src/core/agent-session.ts`，是 coding 专用层：

```typescript
class AgentSession {
  readonly agent: Agent;

  // 工具管理
  private _toolRegistry: Map<string, AgentTool>;
  private _toolDefinitions: Map<string, ToolDefinition>;

  // Session 管理
  private sessionManager: SessionManager;
  private sessionManager: SettingsManager;

  // 扩展系统
  private _extensionRunner: ExtensionRunner | undefined;

  // 核心方法
  async prompt(text: string, options?: PromptOptions): Promise<void>;
  async steer(text: string): Promise<void>;      // 队列消息（中断式）
  async followUp(text: string): Promise<void>;    // 队列消息（等待式）
  async compact(): Promise<CompactionResult>;
}
```

## 3. 工具系统

### 3.1 工具定义 vs 工具实例

pi-mono 区分了 **ToolDefinition**（定义）和 **AgentTool**（实例）：

```typescript
// ToolDefinition - 扩展/SDK 使用的定义格式
interface ToolDefinition<TParameters = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  promptSnippet?: string;       // 提示词片段
  promptGuidelines?: string[]; // 提示词指南
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    ctx?: ExtensionContext,
  ) => Promise<AgentToolResult<TDetails>>;
}

// AgentTool - 传给 Agent 的执行格式
interface AgentTool<TParameters = TSchema, TDetails = unknown> extends Tool<TParameters> {
  label: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### 3.2 工具注册表

`AgentSession` 维护了一个工具注册表，支持动态启停：

```typescript
class AgentSession {
  // 内部注册表
  private _toolRegistry: Map<string, AgentTool> = new Map();
  private _toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();

  // 获取当前活跃工具
  getActiveToolNames(): string[] {
    return this.agent.state.tools.map(t => t.name);
  }

  // 设置活跃工具（按名称）
  setActiveToolsByName(toolNames: string[]): void {
    const tools: AgentTool[] = [];
    for (const name of toolNames) {
      const tool = this._toolRegistry.get(name);
      if (tool) tools.push(tool);
    }
    this.agent.state.tools = tools;
  }
}
```

### 3.3 内置工具

位于 `packages/coding-agent/src/core/tools/`：

| 工具 | 功能 | 可选参数 |
|------|------|---------|
| `read` | 读取文件 | `maxLines`, `maxBytes` |
| `bash` | 执行命令 | `commandPrefix` |
| `edit` | 编辑文件 | - |
| `write` | 写入文件 | - |
| `grep` | 文本搜索 | - |
| `find` | 文件查找 | - |
| `ls` | 目录列表 | - |

## 4. 扩展系统

### 4.1 扩展架构

扩展系统允许自定义代码注入到 Agent 的生命周期中：

```
Extension
    │
    ├── 生命周期事件订阅（agent_start, turn_end, tool_execution_*）
    ├── 工具注册
    ├── 命令注册（slash commands）
    ├── UI 组件
    └── Provider 注册
```

### 4.2 事件类型

```typescript
// Agent 事件（底层）
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; isError: boolean }

// 扩展特定事件
type ExtensionEvent =
  | { type: "before_agent_start" }       // Agent 启动前
  | { type: "context" }                  // 上下文转换
  | { type: "tool_call" }               // 工具调用拦截
  | { type: "tool_result" }             // 工具结果拦截
  | { type: "session_before_compact" }   // 压缩前
  | { type: "session_compact" }          // 压缩完成
  | { type: "model_select" }            // 模型切换
  | // ... 更多
```

### 4.3 工具 Hook 拦截

扩展通过 `beforeToolCall` / `afterToolCall` 拦截工具执行：

```typescript
// AgentSession._installAgentToolHooks()
this.agent.beforeToolCall = async ({ toolCall, args }) => {
  const runner = this._extensionRunner;
  if (!runner?.hasHandlers("tool_call")) return undefined;

  return await runner.emitToolCall({
    type: "tool_call",
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    input: args as Record<string, unknown>,
  });
};

this.agent.afterToolCall = async ({ toolCall, result, isError }) => {
  const runner = this._extensionRunner;
  if (!runner?.hasHandlers("tool_result")) return undefined;

  const hookResult = await runner.emitToolResult({
    type: "tool_result",
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    input: toolCall.arguments,
    content: result.content,
    isError,
  });

  if (!hookResult || isError) return undefined;
  return {
    content: hookResult.content,
    details: hookResult.details,
  };
};
```

## 5. Session 管理

### 5.1 Session 结构

Session 以 **append-only JSONL 文件**存储，支持树形分支：

```
session.jsonl
├── header: { type: "session", id, timestamp, cwd, parentSession? }
├── entry: { type: "message", id, parentId, message }
├── entry: { type: "thinking_level_change", id, parentId, thinkingLevel }
├── entry: { type: "model_change", id, parentId, provider, modelId }
├── entry: { type: "compaction", id, parentId, summary, firstKeptEntryId }
├── entry: { type: "custom_message", id, parentId, customType, content, display }
├── entry: { type: "label", id, parentId, targetId, label }
└── ...
```

### 5.2 树形分支

```typescript
class SessionManager {
  private leafId: string | null;  // 当前叶子节点

  // 创建分支（不修改历史）
  branch(branchFromId: string): void;

  // 带摘要的分支
  branchWithSummary(branchFromId: string, summary: string): void;

  // 构建 LLM 上下文（从根到叶子的路径）
  buildSessionContext(): SessionContext;
}
```

### 5.3 Compaction（上下文压缩）

当上下文过长时，自动压缩历史：

```typescript
interface CompactionResult {
  summary: string;           // 压缩摘要
  firstKeptEntryId: string;  // 保留的第一条消息 ID
  tokensBefore: number;       // 压缩前的 token 数
}

// 压缩后的消息序列：
// [compaction_summary, kept_messages..., post_compaction_messages...]
```

## 6. 关键设计模式

### 6.1 分层解耦

- **Agent** - 纯运行时，无 coding 特定逻辑
- **AgentSession** - coding 特定逻辑（工具、扩展、session）
- **AI Layer** - 多 provider 支持

### 6.2 Hook 扩展点

`beforeToolCall` / `afterToolCall` 是核心扩展机制，让扩展可以：

1. **拦截工具调用** - 阻止或修改参数
2. **修改结果** - 改变返回内容
3. **记录日志** - 审计追踪

### 6.3 消息转换

```typescript
// AgentMessage[] → LLM Message[] 转换
convertToLlm: (messages: AgentMessage[]) => Message[]

// 自定义消息过滤/转换
transformContext: (messages: AgentMessage[]) => Promise<AgentMessage[]>
```

### 6.4 工具定义工厂

内置工具使用工厂模式创建，支持自定义 cwd：

```typescript
// 每次创建 fresh 的工具实例
const readTool = createReadTool(cwd, options);
const bashTool = createBashTool(cwd, options);

// 工具定义（用于注册表）
const readToolDefinition = createReadToolDefinition(cwd, options);
```

## 7. 总结

pi-mono 的 coding-agent 设计核心要点：

1. **分层架构** - Agent 框架与 coding 逻辑分离
2. **Hook 扩展** - `beforeToolCall`/`afterToolCall` 作为核心扩展点
3. **工具注册表** - 支持动态启停工具
4. **Session 树** - append-only + 分支管理
5. **Compaction** - 上下文自动压缩
6. **扩展事件** - 丰富的生命周期事件
