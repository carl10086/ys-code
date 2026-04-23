# ys-code 架构文档

## Pattern Overview

**分层架构 + 事件驱动 Agent 系统**

ys-code 是一个分阶段逼近 Claude Code 的可控实现项目，采用以下核心架构模式：

1. **分层架构**：清晰分离 CLI 接口层、Agent 核心层、AI 抽象层、Session 持久化层、TUI 渲染层和 Web 服务层
2. **事件驱动 Agent**：通过 `Agent` 类和 `runAgentLoop` 函数实现状态化 Agent，事件订阅机制连接各层
3. **Provider 抽象**：AI 能力通过 `src/core/ai/` 的 Provider 注册表支持多后端（Anthropic/MiniMax）

---

## Layers

### 1. CLI 接口层 (`src/main.ts`)

**职责**：程序入口，命令行解析，启动协调

**位置**：`src/main.ts`

**包含内容**：
- Commander.js 命令行解析
- Web 服务器生命周期管理
- TUI 启动入口
- 全局错误处理和日志初始化

**依赖关系**：依赖 TUI 层和 Web 层

```
CLI Options:
  --web    启动时同时开启 Web 预览
```

---

### 2. Agent 核心层 (`src/agent/`)

**职责**：状态化 Agent 实现，消息路由，工具执行，Agent 循环控制

**位置**：`src/agent/`

**目录结构**：
```
src/agent/
├── agent.ts           # Agent 类 - 状态化封装，管理消息队列和生命周期
├── agent-loop.ts      # runAgentLoop / runAgentLoopContinue - 核心循环逻辑
├── session.ts        # AgentSession - Agent 与 SessionManager 的桥接
├── types.ts          # 类型定义（AgentTool, AgentEvent, AgentState, AgentMessage）
├── tool-execution.ts # 工具执行逻辑
├── stream-assistant.ts# Assistant 响应流式处理
├── attachments/      # 附件处理
├── context/          # 上下文管理
├── system-prompt/    # 系统提示词构建
│   └── sections/     # 系统提示词分段
└── tools/            # 内置工具（read, write, edit, bash, glob）
```

**关键抽象**：

| 类型/类 | 文件 | 用途 |
|---------|------|------|
| `Agent` | `agent.ts` | 状态化 Agent wrapper，封装消息队列（steering/follow-up）、事件订阅 |
| `runAgentLoop` | `agent-loop.ts` | 低层循环函数，执行单次 turn、工具调用、循环终止判断 |
| `AgentTool<T, R>` | `types.ts` | 工具定义接口，包含权限检查、参数校验、执行逻辑 |
| `PendingMessageQueue` | `agent.ts` | 消息队列，支持 "all" 和 "one-at-a-time" 两种模式 |

**依赖关系**：依赖 AI 层（`src/core/ai/`）、Session 层（`src/session/`）、工具定义

---

### 3. AI 抽象层 (`src/core/ai/`)

**职责**：AI Provider 注册，多后端支持，消息格式转换，流式处理，Token 估算

**位置**：`src/core/ai/`

**目录结构**：
```
src/core/ai/
├── index.ts              # 主导出
├── api-registry.ts       # Provider 注册表
├── models.ts             # 模型定义
├── models.generated.ts   # 生成的模型列表
├── stream.ts             # 流式工具函数
├── types.ts              # AI 类型定义
├── env-api-keys.ts       # API Key 管理
├── providers/           # Provider 实现
│   ├── anthropic.ts     # Anthropic/MiniMax Provider
│   └── register-builtins.ts # 内置 Provider 注册
└── utils/               # 工具函数
    ├── event-stream.js  # SSE 事件流处理
    ├── json-parse.js    # JSON 解析
    ├── overflow.js      # 上下文溢出检测
    └── validation.js    # 工具参数校验
```

**关键抽象**：

| 导出 | 文件 | 用途 |
|------|------|------|
| `streamSimple` | `stream.ts` | 通用流式请求函数 |
| `getModel` | `models.ts` | 获取模型配置 |
| `getEnvApiKey` | `env-api-keys.ts` | 获取环境变量中的 API Key |
| `validateToolArguments` | `utils/validation.ts` | 工具参数校验 |

**Provider 注册机制**：使用注册表模式，通过 `api-registry.ts` 的 `ApiProviderRegistry` 动态注册和获取 Provider。

**依赖关系**：被 Agent 层和 TUI 层依赖

---

### 4. Session 持久化层 (`src/session/`)

**职责**：会话文件存储、会话恢复、消息压缩（compact）

**位置**：`src/session/`

**目录结构**：
```
src/session/
├── session-manager.ts    # SessionManager - 统一入口，管理存储/加载/compact
├── session-storage.ts   # SessionStorage - 文件追加写入
├── session-loader.ts    # SessionLoader - 从文件恢复消息
├── compact.ts           # CompactTrigger - 压缩触发逻辑
├── token-estimator.ts   # Token 估算
└── entry-types.ts       # Entry 类型定义
```

**关键设计**：

| 类 | 文件 | 用途 |
|---|------|------|
| `SessionManager` | `session-manager.ts` | 统一入口，创建/恢复会话，追加消息，触发 compact |
| `SessionStorage` | `session-storage.ts` | 文件追加写入，按 UUID 追踪消息血缘 |
| `CompactTrigger` | `compact.ts` | 判断何时触发压缩，创建压缩边界 |

**Entry 类型**：`header`、`user`、`assistant`、`toolResult`、`compact_boundary`

**依赖关系**：被 Agent 层依赖，使用 `src/utils/logger.js`

---

### 5. TUI 渲染层 (`src/tui/`)

**职责**：Ink/React 终端 UI 渲染，消息列表，用户输入，状态栏

**位置**：`src/tui/`

**目录结构**：
```
src/tui/
├── index.tsx         # TUI 入口，startTUI 函数
├── app.tsx          # App 根组件
├── components/      # UI 组件
│   ├── MessageList.tsx  # 消息列表
│   ├── PromptInput.tsx  # 命令输入
│   └── StatusBar.tsx   # 状态栏
├── hooks/           # React Hooks
│   └── useAgent.ts # Agent 状态管理 hook
└── utils/           # TUI 工具函数
```

**关键组件**：

| 组件 | 文件 | 用途 |
|------|------|------|
| `App` | `app.tsx` | 根组件，整合 Agent 状态和命令处理 |
| `MessageList` | `components/MessageList.tsx` | 消息渲染列表 |
| `PromptInput` | `components/PromptInput.tsx` | 用户输入处理，支持 slash 命令 |
| `StatusBar` | `components/StatusBar.tsx` | 底部状态栏，显示模型/分支/Token |

**关键 Hook**：`useAgent` - 管理 Agent 实例、消息状态、滚动控制

**依赖关系**：依赖 Agent 层、Commands 层（`src/commands/`）

---

### 6. Commands 层 (`src/commands/`)

**职责**：Slash 命令实现（`/clear`、`/debug`、`/exit`、`/help`、`/skills`、`/system`、`/tools`）

**位置**：`src/commands/`

**包含内容**：命令注册表、命令执行器、各命令处理器

**依赖关系**：被 TUI 层依赖

---

### 7. Web 服务层 (`src/web/`)

**职责**：Bun HTTP 服务器，会话 API，Web 预览

**位置**：`src/web/`

**目录结构**：
```
src/web/
├── index.ts         # 导出
├── server.ts        # Bun 服务器创建/停止
├── routes.ts        # 路由构建
├── session-api.ts   # 会话 API 处理器
└── pages/          # Web 页面（HTML）
```

**关键函数**：`createWebServer` - 创建 Bun 服务器，注册路由

**依赖关系**：被 CLI 层依赖

---

### 8. Skills 层 (`src/skills/`)

**职责**：技能系统，动态加载 `.claude/skills/` 目录

**位置**：`src/skills/`

**关键函数**：
- `loadSkillsDir` - 从目录加载技能
- `parseFrontmatter` - 解析技能头部的 frontmatter

---

### 9. 工具层 (`src/tools/`)

**职责**：工具 exports，重新导出 `src/agent/tools/`

---

### 10. 工具函数层 (`src/utils/`)

**职责**：通用工具函数（日志、Git 分支获取等）

**位置**：`src/utils/`

**关键模块**：`logger.js` - Pino 日志实例

---

## Data Flow

### 完整消息流程

```
用户输入
    ↓
CLI (main.ts) → startTUI()
    ↓
TUI App (app.tsx) → handleSubmit()
    ↓
Agent.prompt() / Agent.steer()
    ↓
Agent.runPromptMessages()
    ↓
runAgentLoop() [agent-loop.ts]
    ↓
streamAssistantResponse() → AI Provider
    ↓
executeToolCalls() [tool-execution.ts]
    ↓
SessionManager.appendMessage() [session-manager.ts]
    ↓
SessionStorage.appendEntry() [session-storage.ts]
    ↓
文件追加写入
```

### 事件流

```
AI Provider 流式响应
    ↓
Agent.processEvents()
    ↓
Event 类型：message_start / message_update / message_end / tool_execution_start / tool_execution_end / turn_end / agent_start / agent_end
    ↓
TUI useAgent hook 监听
    ↓
React 状态更新 → UI 重新渲染
```

### Session 持久化流程

```
新消息 → SessionManager.appendMessage()
    ↓
messageToEntry() 转换为 Entry 类型
    ↓
SessionStorage.appendEntry()
    ↓
文件追加 [sessionId].jsonl
    ↓
CompactTrigger.shouldCompact() 检查
    ↓
超过阈值 → 追加 compact_boundary Entry
```

---

## Key Abstractions

### Agent 类 (`src/agent/agent.ts`)

```typescript
class Agent {
  state: AgentState;           // 内部状态（model, messages, tools, thinkingLevel）
  subscribe(listener): ()=>void; // 事件订阅
  prompt(input): Promise<void>; // 发起新 prompt
  continue(): Promise<void>;   // 从当前状态继续
  steer(message): void;        // 引导消息（在当前 turn 结束后注入）
  followUp(message): void;     // 后续消息（仅在 agent 停止后运行）
  abort(): void;               // 中止当前运行
}
```

### AgentTool 接口 (`src/agent/types.ts`)

```typescript
interface AgentTool<T = unknown, R = unknown> {
  name: string;
  description?: string;
  inputSchema: TSchema;         // Zod/TypeBox schema
  execute: (args: T, context: ToolContext) => Promise<R>;
}
```

### Provider 注册表 (`src/core/ai/api-registry.ts`)

```typescript
class ApiProviderRegistry {
  register(provider: ApiProvider): void;
  get(provider: string): ApiProvider;
  list(): ApiProvider[];
}
```

### SessionManager (`src/session/session-manager.ts`)

```typescript
class SessionManager {
  sessionId: string;
  filePath: string;
  appendMessage(message: AgentMessage): void;     // 追加消息并持久化
  restoreMessages(): AgentMessage[];              // 从磁盘加载活跃分支
  compactIfNeeded(): void;                       // 必要时触发 compact
  static restoreLatest(config): SessionManager | null; // 恢复最近会话
}
```

---

## Entry Points

### CLI 入口

**文件**：`src/main.ts`

**启动方式**：
```bash
bun run src/main.ts          # CLI 模式
bun run src/main.ts --web    # 同时启动 Web 预览
```

**流程**：
1. 解析命令行选项
2. 可选：创建 Web 服务器
3. 调用 `startTUI()` 启动 TUI
4. 注册 SIGINT 处理

### TUI 入口

**文件**：`src/tui/index.tsx`

**函数**：`startTUI()`

**渲染**：`render(<App />)` 到终端

### Web 服务器入口

**文件**：`src/web/server.ts`

**函数**：`createWebServer(config?)`

**返回**：`{ port, url, stop }`

---

## Error Handling

### 错误处理策略

| 层级 | 策略 | 实现 |
|------|------|------|
| CLI | 全局 try-catch | `main().catch()` 捕获未处理错误 |
| Agent | 错误消息追加到 transcript | `handleRunFailure()` 创建 error 消息 |
| Tool Execution | 工具结果标记 `isError` | `executeToolCalls()` 捕获异常 |
| Session | 文件锁 + 异常日志 | `proper-lockfile` + `SessionStorage` |
| TUI | React Error Boundary | 未实现（TODO） |

### Agent 错误传播

```typescript
// agent.ts handleRunFailure()
errorMessage = {
  role: "assistant",
  content: [{ type: "text", text: "" }],
  stopReason: "error",
  errorMessage: error.message,
  timestamp: Date.now(),
}
```

---

## Cross-Cutting Concerns

### 日志

**实现**：Pino（`src/utils/logger.js`）

**日志级别**：通过 `LOG_LEVEL` 环境变量配置

**使用位置**：所有主要模块

### 模型配置

**实现**：`src/core/ai/models.ts`

**配置内容**：模型 ID、名称、API 类型、Provider、Base URL、Token 成本、上下文窗口

**获取方式**：`getModel(provider, modelId)`

### API Key 管理

**实现**：`src/core/ai/env-api-keys.ts`

**获取方式**：`getEnvApiKey(provider)`

**支持 Provider**：从环境变量 `ANTHROPIC_API_KEY`、`MINIMAX_API_KEY` 等读取

### 思考预算（Thinking Budgets）

**实现**：通过 `src/core/ai/` 的 `ThinkingBudgets` 类型支持

**配置方式**：`Agent` 构造选项 `thinkingBudgets`

---

## Where to Add New Code

### 新建内置工具

**位置**：`src/agent/tools/`

**示例**：参考 `src/agent/tools/read.ts`、`src/agent/tools/write.ts`

**注册**：工具通过 `Agent` 构造选项的 `initialState.tools` 注入

```typescript
// 新建 src/agent/tools/my-tool.ts
export const myTool = {
  name: "my_tool",
  description: "描述",
  inputSchema: Type.Object({ ... }),
  async execute(args, context) { ... }
} satisfies AgentTool;
```

### 新建 AI Provider

**位置**：`src/core/ai/providers/`

**示例**：参考 `src/core/ai/providers/anthropic.ts`

**注册**：在 `src/core/ai/providers/register-builtins.ts` 中注册

```typescript
// 新建 src/core/ai/providers/my-provider.ts
export class MyProvider implements ApiProvider {
  // 实现 required methods
}

// 注册到 register-builtins.ts
registry.register(new MyProvider());
```

### 新建 TUI 组件

**位置**：`src/tui/components/`

**示例**：参考 `src/tui/components/MessageList.tsx`

**要求**：使用 Ink 的 `<Box>` 和 React 组件

### 新建 Slash 命令

**位置**：`src/commands/`

**示例**：参考 `src/commands/help.ts`

**注册**：在 `src/commands/index.ts` 的 `getCommands()` 中注册

### 新建 Skill

**位置**：`.claude/skills/<skill-name>/SKILL.md`

**格式**：Frontmatter + Markdown

```markdown
---
name: my-skill
description: 技能描述
---

# My Skill

技能内容...
```

### 新建 Web 页面

**位置**：`src/web/pages/`

**注册**：在 `src/web/routes.ts` 中添加路由

### 新建 Session Entry 类型

**位置**：`src/session/entry-types.ts`

**要求**：实现 `Entry` 接口，包含 `type`、`uuid`、`parentUuid`、`timestamp`

---

## Tech Stack

| 类别 | 技术 |
|------|------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| TUI Framework | Ink + React |
| AI/ML | `@ai-sdk/anthropic`, `@anthropic-ai/sdk`, `ai` |
| CLI Parsing | `@commander-js/extra-typings` |
| Validation | Zod, `@sinclair/typebox` |
| Serialization | YAML, JSONC |
| LSP/RPC | `vscode-jsonrpc`, `vscode-languageserver-types` |
| Web Server | Bun built-in HTTP |
| Logging | Pino |
| Process | Execa, `proper-lockfile` |
| Pattern Matching | Picomatch, Fuse.js |

---

## Project Structure

```
ys-code/
├── src/
│   ├── main.ts              # CLI 入口
│   ├── agent/               # Agent 核心
│   ├── cli/                 # CLI 格式化
│   ├── commands/            # Slash 命令
│   ├── core/               # 核心抽象
│   │   └── ai/             # AI 抽象层
│   ├── session/            # 会话管理
│   ├── skills/             # 技能系统
│   ├── tools/              # 工具导出
│   ├── tui/                # 终端 UI
│   ├── utils/              # 工具函数
│   └── web/                # Web 服务
├── docs/
│   └── codebase/
│       └── ARCHITECTURE.md # 本文档
├── refer/                  # 外部参考符号链接
│   ├── claude-code-haha/  # 核心参考
│   ├── pi-mono/           # 架构参考
│   └── cc-query-snapshots/# 运行时快照
└── package.json
```
