# pi-mono 扩展系统详解

## 1. 扩展概述

pi-mono 的扩展系统允许在 Agent 生命周期中注入自定义逻辑，支持：
- 订阅 Agent 生命周期事件
- 注册自定义工具
- 注册 slash commands
- 修改 UI
- 拦截工具调用/结果

## 2. 扩展结构

```typescript
// 扩展定义
interface Extension {
  name: string;
  version?: string;

  // 生命周期
  onStart?(ctx: ExtensionContext): Promise<void>;
  onStop?(): Promise<void>;

  // 注册处理器
  register(ctx: ExtensionContext): ExtensionHandlers | Promise<ExtensionHandlers>;
}

// 处理器集合
interface ExtensionHandlers {
  // 事件处理
  agent_start?: AgentStartHandler;
  agent_end?: AgentEndHandler;
  turn_start?: TurnStartHandler;
  turn_end?: TurnEndHandler;
  message_start?: MessageStartHandler;
  message_end?: MessageEndHandler;

  // 工具拦截
  tool_call?: ToolCallHandler;
  tool_result?: ToolResultHandler;

  // 上下文
  before_agent_start?: BeforeAgentStartHandler;
  context?: ContextHandler;

  // Provider
  before_provider_request?: BeforeProviderRequestHandler;

  // Session
  session_before_compact?: SessionBeforeCompactHandler;
  session_compact?: SessionCompactHandler;
  session_before_tree?: SessionBeforeTreeHandler;
  session_tree?: SessionTreeHandler;

  // 工具定义
  tools?: ToolDefinition[];
}
```

## 3. 创建扩展

### 3.1 基础扩展

```typescript
import { defineExtension, type ExtensionContext } from "@mariozechner/pi-coding-agent";

export default defineExtension({
  name: "my-extension",

  async register(ctx) {
    return {
      // 订阅 agent 事件
      agent_start: () => {
        console.log("Agent started!");
      },

      turn_end: (event) => {
        if (event.message.role === "assistant") {
          console.log("Assistant responded");
        }
      },
    };
  },
});
```

### 3.2 拦截工具调用

```typescript
export default defineExtension({
  name: "tool-interceptor",

  register(ctx) {
    return {
      tool_call: async (event) => {
        console.log("Tool call:", event.toolName, event.input);

        // 可以阻止执行
        if (event.toolName === "bash" && event.input.command.includes("rm -rf")) {
          return { block: true, reason: "Dangerous command blocked" };
        }

        // 或修改参数
        if (event.toolName === "bash") {
          return {
            input: {
              ...event.input,
              command: `set -e && ${event.input.command}`,
            },
          };
        }

        return undefined; // 不拦截，继续执行
      },

      tool_result: async (event) => {
        console.log("Tool result:", event.toolName, event.content);

        // 可以修改结果
        if (event.toolName === "read" && event.content.some(c => c.type === "text")) {
          return {
            content: event.content.map(c => {
              if (c.type === "text") {
                return {
                  ...c,
                  text: c.text.toUpperCase(), // 示例：转大写
                };
              }
              return c;
            }),
          };
        }

        return undefined;
      },
    };
  },
});
```

### 3.3 注册自定义工具

```typescript
import { Type } from "@sinclair/typebox";

export default defineExtension({
  name: "custom-tools",

  register(ctx) {
    return {
      tools: [
        {
          name: "search_github",
          label: "Search GitHub",
          description: "Search for repositories on GitHub",
          parameters: Type.Object({
            query: Type.String({ description: "Search query" }),
            page: Type.Optional(Type.Number()),
          }),
          async execute(toolCallId, params, signal) {
            const response = await fetch(
              `https://api.github.com/search/repositories?q=${params.query}&page=${params.page ?? 1}`
            );
            const data = await response.json();

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(data.items.slice(0, 5)),
                },
              ],
              details: { total: data.total_count },
            };
          },
        },
      ],
    };
  },
});
```

### 3.4 注册 Slash Commands

```typescript
export default defineExtension({
  name: "custom-commands",

  register(ctx) {
    return {
      // 需要通过 ExtensionRunner 注册命令
      // 在 onStart 中注册
    };

    // 或者使用命令处理器
  },
});
```

## 4. 扩展 Runner

`ExtensionRunner` 是扩展的运行时管理器：

```typescript
class ExtensionRunner {
  // 检查是否有特定处理器
  hasHandlers(eventType: string): boolean;

  // 触发事件
  emit(event: ExtensionEvent): Promise<void>;

  // 触发工具调用拦截
  emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined>;

  // 触发工具结果拦截
  emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined>;

  // 获取注册的命令
  getRegisteredCommands(): RegisteredCommand[];

  // 获取注册的工具
  getAllRegisteredTools(): RegisteredTool[];
}
```

## 5. 扩展 API

扩展上下文 `ExtensionContext` 提供：

```typescript
interface ExtensionContext {
  // UI
  ui: ExtensionUIContext;        // 对话框、通知等
  hasUI: boolean;              // 是否有 UI

  // 环境
  cwd: string;                  // 工作目录
  sessionManager: SessionManager;
  modelRegistry: ModelRegistry;

  // Agent 状态
  model: Model<any> | undefined;
  isIdle(): boolean;
  signal: AbortSignal | undefined;

  // 控制
  abort(): void;
  hasPendingMessages(): boolean;
  shutdown(): void;

  // 上下文
  getContextUsage(): ContextUsage | undefined;
  getSystemPrompt(): string;

  // Session 控制
  compact(options?: CompactOptions): void;
}
```

## 6. 事件流

```
Agent Event                    Extension Handler
──────────────────────────────────────────────────

agent_start ──────────────────► agent_start
                                 before_agent_start ──────► [before_agent_start]
                                 context ────────────────► [context]

turn_start ──────────────────► turn_start
turn_end ──────────────────────► turn_end

message_start ────────────────► message_start
message_end ───────────────────► message_end

tool_execution_start ─────────► [tool_call] ────────► beforeToolCall hook
                               [tool_call handler]
                               ↓ (block=true?)
                               [阻止执行]

tool_execution_end ────────────► [tool_result] ─────► afterToolCall hook
                               [tool_result handler]
                               ↓ (返回内容?)
                               [修改结果]

agent_end ────────────────────► agent_end
```

## 7. 工具执行拦截详解

### 7.1 拦截点

```typescript
// 1. beforeToolCall - 工具执行前
interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;    // { id, name, arguments }
  args: unknown;              // 验证后的参数
  context: AgentContext;
}

// 返回结果
interface BeforeToolCallResult {
  block?: boolean;           // 阻止执行
  reason?: string;            // 阻止原因
  input?: Record<string, unknown>;  // 修改参数
}

// 2. afterToolCall - 工具执行后
interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult;   // 执行结果
  isError: boolean;
  context: AgentContext;
}

// 返回结果
interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
}
```

### 7.2 执行顺序

```
用户请求
    │
    ▼
AgentLoop.streamAssistantResponse()
    │
    ▼
LLM 返回 tool_call
    │
    ▼
AgentLoop.executeToolCalls()
    │
    ├── 1. prepareToolCall() ──────► beforeToolCall hook
    │                                      │
    │                                      ▼ (block?)
    │                              返回 { block: true }?
    │                                      │
    │                                      ▼ (修改参数?)
    │                              返回 { input: {...} }
    │
    ├── 2. executePreparedToolCall()
    │         │
    │         ▼
    │    tool.execute()
    │
    └── 3. finalizeExecutedToolCall() ──► afterToolCall hook
                                              │
                                              ▼ (修改结果?)
                                      返回 { content: [...] }
```

## 8. 内置扩展示例

### 8.1 危险命令拦截

```typescript
export default defineExtension({
  name: "dangerous-command-guard",

  register(ctx) {
    return {
      tool_call: async (event) => {
        if (event.toolName !== "bash") return undefined;

        const cmd = event.input.command;
        const dangerous = /rm\s+-rf|dd\s+|mkfs|:(){ :|:& };:/;

        if (dangerous.test(cmd)) {
          return {
            block: true,
            reason: `Command "${cmd}" is not allowed`,
          };
        }

        return undefined;
      },
    };
  },
});
```

### 8.2 输出过滤

```typescript
export default defineExtension({
  name: "sensitive-output-filter",

  register(ctx) {
    return {
      tool_result: async (event) => {
        if (event.toolName !== "bash") return undefined;

        const texts = event.content.filter(c => c.type === "text");
        for (const text of texts) {
          // 过滤敏感信息
          text.text = text.text.replace(/sk-[a-zA-Z0-9]{20,}/g, "***REDACTED***");
        }

        return { content: texts };
      },
    };
  },
});
```

### 8.3 上下文注入

```typescript
export default defineExtension({
  name: "context-injector",

  register(ctx) {
    return {
      before_agent_start: async (event) => {
        return {
          messages: [
            {
              role: "custom" as const,
              customType: "context",
              content: "Additional context...",
              display: false,
            },
          ],
        };
      },
    };
  },
});
```

## 9. 扩展加载

```typescript
// 从目录加载扩展
const result = await discoverAndLoadExtensions({
  extensionsDir: "./extensions",
  cwd: process.cwd(),
});

console.log(result.extensions.length);   // 加载的扩展数
console.log(result.runtime.flagValues);  // 扩展设置的 flags

// 或者从工厂加载
const ext = await loadExtensionFromFactory(
  { name: "my-ext", path: "/path/to/ext" },
  { cwd, sessionManager, modelRegistry }
);
```
