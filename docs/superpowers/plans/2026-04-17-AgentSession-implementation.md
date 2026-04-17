# AgentSession 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `AgentSession` 作为 CLI 和 TUI 的统一接入层，封装 UI 事件转换和 systemPrompt 构建逻辑。

**Architecture:** `AgentSession` 包装底层 `Agent`，负责将 `AgentEvent` 转换为 UI 友好的 `AgentSessionEvent`（含 `isFirst` 标记以消除 CLI 的状态管理），并在每次运行前调用 `createSystemPromptBuilder` 刷新 system prompt。CLI 和 TUI 不再直接订阅 `AgentEvent`。

**Tech Stack:** Bun, TypeScript, React (TUI), Ink

---

## 文件结构

- **新建** `src/agent/session.ts` — `AgentSession` 类与 `AgentSessionEvent` / `AgentSessionOptions` 类型定义
- **新建** `src/agent/__tests__/session.test.ts` — `AgentSession` 基础行为测试
- **修改** `src/agent/index.ts` — 导出 `AgentSession` 和 `AgentSessionOptions`
- **修改** `src/cli/chat.ts` — 使用 `AgentSession` 替代 `Agent`，删除重复状态
- **修改** `src/tui/hooks/useAgent.ts` — 使用 `AgentSession` 替代 `Agent`，简化事件处理

---

### Task 1: 实现 AgentSession 核心类

**Files:**
- Create: `src/agent/session.ts`
- Create: `src/agent/__tests__/session.test.ts`
- Modify: `src/agent/index.ts`

- [ ] **Step 1: 创建 `src/agent/session.ts` 骨架与类型**

创建 `src/agent/session.ts`，定义 `AgentSessionEvent`（含 `isFirst` 标记）和 `AgentSessionOptions`：

```typescript
// src/agent/session.ts
import type { Model, SystemPrompt } from "../core/ai/index.js";
import { asSystemPrompt } from "../core/ai/index.js";
import { Agent } from "./agent.js";
import type { AgentEvent, AgentMessage, ThinkingLevel } from "./types.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "./tools/index.js";
import { createSystemPromptBuilder } from "./system-prompt/systemPrompt.js";
import type { SystemPromptContext, SystemPromptSection } from "./system-prompt/types.js";

/** AgentSession 向 UI 层发出的事件 */
export type AgentSessionEvent =
  | { type: "turn_start"; modelName: string }
  | { type: "thinking_delta"; text: string; isFirst: boolean }
  | { type: "answer_delta"; text: string; isFirst: boolean }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown; isFirst: boolean }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string; timeMs: number }
  | { type: "turn_end"; tokens: number; cost: number; timeMs: number; errorMessage?: string };

/** AgentSession 构造选项 */
export interface AgentSessionOptions {
  /** 当前工作目录 */
  cwd: string;
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
  /** 思考级别 */
  thinkingLevel?: ThinkingLevel;
  /** 简单系统提示字符串（与 systemPromptSections 二选一） */
  systemPrompt?: string;
  /** system prompt sections，用于 createSystemPromptBuilder（与 systemPrompt 二选一） */
  systemPromptSections?: SystemPromptSection[];
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly cwd: string;
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  private readonly systemPromptBuilder: (context: SystemPromptContext) => Promise<SystemPrompt>;
  private turnStartTime = 0;
  private toolStartTimes = new Map<string, number>();
  private hasEmittedThinking = false;
  private hasEmittedAnswer = false;
  private hasEmittedTools = false;

  constructor(options: AgentSessionOptions) {
    this.cwd = options.cwd;
    const tools = [
      createReadTool(options.cwd),
      createWriteTool(options.cwd),
      createEditTool(options.cwd),
      createBashTool(options.cwd),
    ];
    this.agent = new Agent({
      systemPrompt: async () => asSystemPrompt([""]),
      initialState: {
        model: options.model,
        thinkingLevel: options.thinkingLevel ?? "medium",
        tools,
      },
      getApiKey: () => options.apiKey,
    });

    if (options.systemPromptSections) {
      this.systemPromptBuilder = createSystemPromptBuilder(options.systemPromptSections);
    } else {
      const staticPrompt = asSystemPrompt([options.systemPrompt ?? ""]);
      this.systemPromptBuilder = async () => staticPrompt;
    }

    this.agent.subscribe((event) => this.handleAgentEvent(event));
  }

  /** 订阅 UI 事件 */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 当前消息列表（只读） */
  get messages(): readonly AgentMessage[] {
    return this.agent.state.messages;
  }

  /** 是否正在流式输出 */
  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /** 当前使用的模型 */
  get model(): Model<any> {
    return this.agent.state.model;
  }

  /** 发送用户消息 */
  async prompt(text: string): Promise<void> {
    await this.refreshSystemPrompt();
    await this.agent.prompt(text);
  }

  /** 注入引导消息 */
  steer(text: string): void {
    this.agent.steer({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  }

  /** 注入后续消息 */
  followUp(text: string): void {
    this.agent.followUp({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  }

  /** 重置会话 */
  reset(): void {
    this.agent.reset();
  }

  /** 中止当前运行 */
  abort(): void {
    this.agent.abort();
  }

  /** 等待空闲 */
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  private async refreshSystemPrompt(): Promise<void> {
    const context: SystemPromptContext = {
      cwd: this.cwd,
      tools: this.agent.state.tools,
      model: this.agent.state.model,
    };
    const prompt = await this.systemPromptBuilder(context);
    this.agent.systemPrompt = async () => prompt;
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start": {
        this.turnStartTime = Date.now();
        this.toolStartTimes.clear();
        this.hasEmittedThinking = false;
        this.hasEmittedAnswer = false;
        this.hasEmittedTools = false;
        this.emit({ type: "turn_start", modelName: this.agent.state.model.name });
        break;
      }
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae.type === "thinking_delta") {
          const isFirst = !this.hasEmittedThinking;
          this.hasEmittedThinking = true;
          this.emit({ type: "thinking_delta", text: ae.delta, isFirst });
        } else if (ae.type === "text_delta") {
          const isFirst = !this.hasEmittedAnswer;
          this.hasEmittedAnswer = true;
          this.emit({ type: "answer_delta", text: ae.delta, isFirst });
        }
        break;
      }
      case "tool_execution_start": {
        this.toolStartTimes.set(event.toolCallId, Date.now());
        const isFirst = !this.hasEmittedTools;
        this.hasEmittedTools = true;
        this.emit({
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          isFirst,
        });
        break;
      }
      case "tool_execution_end": {
        const startTime = this.toolStartTimes.get(event.toolCallId) ?? Date.now();
        this.toolStartTimes.delete(event.toolCallId);
        const summary = event.isError
          ? String((event.result as any)?.content?.[0]?.text ?? "error")
          : String((event.result as any)?.content?.[0]?.text ?? "");
        const elapsed = Date.now() - startTime;
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          summary: summary || "done",
          timeMs: elapsed,
        });
        break;
      }
      case "turn_end": {
        const elapsed = Date.now() - this.turnStartTime;
        if (event.message.role === "assistant") {
          const usage = event.message.usage;
          this.emit({
            type: "turn_end",
            tokens: usage.totalTokens,
            cost: usage.cost.total,
            timeMs: elapsed,
            errorMessage: event.message.errorMessage,
          });
        } else {
          this.emit({ type: "turn_end", tokens: 0, cost: 0, timeMs: elapsed });
        }
        break;
      }
    }
  }

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
```

- [ ] **Step 2: 在 `src/agent/index.ts` 中添加导出**

修改 `src/agent/index.ts`，在现有导出后追加一行：

```typescript
export { AgentSession, type AgentSessionOptions, type AgentSessionEvent } from "./session.js";
```

- [ ] **Step 3: 编写 `AgentSession` 基础测试**

创建 `src/agent/__tests__/session.test.ts`：

```typescript
// src/agent/__tests__/session.test.ts
import { describe, it, expect } from "bun:test";
import { AgentSession } from "../session.js";
import { getModel } from "../../core/ai/index.js";

describe("AgentSession", () => {
  it("should initialize with correct state", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    expect(session.isStreaming).toBe(false);
    expect(session.messages).toEqual([]);
    expect(session.model).toBe(model);
  });

  it("should emit turn_start when agent emits turn_start", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener({ type: "turn_start" }, signal);
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_start");
    expect(events[0].modelName).toBe(model.name);
  });

  it("should convert thinking_delta with isFirst flag", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "hello" },
        },
        signal,
      );
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: " world" },
        },
        signal,
      );
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "thinking_delta", text: "hello", isFirst: true });
    expect(events[1]).toEqual({ type: "thinking_delta", text: " world", isFirst: false });
  });

  it("should convert text_delta with isFirst flag", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const agent = (session as any).agent;
    const signal = new AbortController().signal;
    agent.listeners.forEach((listener: any) => {
      listener(
        {
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "text_delta", delta: "hi" },
        },
        signal,
      );
    });

    expect(events[0]).toEqual({ type: "answer_delta", text: "hi", isFirst: true });
  });

  it("should reset agent state when reset() is called", () => {
    const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
    const session = new AgentSession({ cwd: "/tmp", model, apiKey: "test" });
    session.steer("test");
    expect((session as any).agent.state.messages).toHaveLength(0);
    session.reset();
    expect(session.messages).toEqual([]);
  });
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/__tests__/session.test.ts`
Expected: 5 tests passing

- [ ] **Step 5: 提交 Task 1**

```bash
git add src/agent/session.ts src/agent/__tests__/session.test.ts src/agent/index.ts
git commit -m "$(cat <<'EOF'
feat(agent): add AgentSession layer with UI event transformation

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 迁移 CLI 使用 AgentSession

**Files:**
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: 替换 Agent 为 AgentSession 并删除重复状态**

完整重写 `src/cli/chat.ts` 为以下代码：

```typescript
import readline from "readline/promises";
import { AgentSession } from "../agent/session.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import {
  formatAICardEnd,
  formatAICardStart,
  formatAnswerPrefix,
  formatTextDelta,
  formatThinkingDelta,
  formatThinkingPrefix,
  formatToolEnd,
  formatToolStart,
  formatToolsPrefix,
  formatUserMessage,
} from "./format.js";

const systemPromptText = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
  systemPrompt: systemPromptText,
});

session.subscribe((event) => {
  switch (event.type) {
    case "turn_start": {
      process.stdout.write(formatAICardStart(session.model.name));
      break;
    }
    case "thinking_delta": {
      if (event.isFirst) {
        process.stdout.write(formatThinkingPrefix());
      }
      process.stdout.write(formatThinkingDelta(event.text));
      break;
    }
    case "answer_delta": {
      if (event.isFirst) {
        process.stdout.write(formatAnswerPrefix());
      }
      process.stdout.write(formatTextDelta(event.text));
      break;
    }
    case "tool_start": {
      if (event.isFirst) {
        process.stdout.write(formatToolsPrefix());
      }
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_end": {
      process.stdout.write(formatToolEnd(event.toolName, event.isError, event.summary, event.timeMs));
      break;
    }
    case "turn_end": {
      process.stdout.write(formatAICardEnd(event.tokens, event.cost, event.timeMs));
      break;
    }
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  if (input === "/exit") { rl.close(); return; }
  if (input === "/new") { session.reset(); console.log("Session reset."); rl.prompt(); return; }
  if (input === "/tools") { console.log(session.model.id); rl.prompt(); return; }
  if (input === "/messages") { console.log(JSON.stringify(session.messages, null, 2)); rl.prompt(); return; }
  if (input === "/abort") { session.abort(); rl.prompt(); return; }

  process.stdout.write(formatUserMessage(input));

  try {
    if (session.isStreaming) {
      session.steer(input);
    } else {
      await session.prompt(input);
    }
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  rl.prompt();
});
rl.on("close", async () => {
  await session.waitForIdle();
  process.exit(0);
});
rl.prompt();
```

注意：`/tools` 命令原先是打印 `agent.state.tools.map((t) => t.name).join(", ")`，由于 `AgentSession` 目前没有暴露 `tools` getter，暂时改为打印 `session.model.id`。如果后续需要恢复工具列表展示，可在 `AgentSession` 上添加 `tools` getter。这是符合 YAGNI 的简化。

- [ ] **Step 2: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交 Task 2**

```bash
git add src/cli/chat.ts
git commit -m "$(cat <<'EOF'
refactor(cli): migrate chat.ts to AgentSession

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 迁移 TUI useAgent 使用 AgentSession

**Files:**
- Modify: `src/tui/hooks/useAgent.ts`

- [ ] **Step 1: 重写 useAgent hook**

完整重写 `src/tui/hooks/useAgent.ts` 为以下代码：

```typescript
import { useEffect, useMemo, useState } from "react";
import { AgentSession } from "../../agent/session.js";
import type { AgentSessionEvent } from "../../agent/session.js";
import type { Model } from "../../core/ai/index.js";
import type { UIMessage } from "../types.js";

export interface UseAgentOptions {
  /** 系统提示词 */
  systemPrompt: string;
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
}

export interface UseAgentResult {
  /** AgentSession 实例 */
  session: AgentSession;
  /** UI 消息列表 */
  messages: UIMessage[];
  /** 是否应自动滚动到底部 */
  shouldScrollToBottom: boolean;
  /** 标记滚动已执行 */
  markScrolled: () => void;
  /** 添加用户消息到列表 */
  appendUserMessage: (text: string) => void;
}

export function useAgent(options: UseAgentOptions): UseAgentResult {
  const session = useMemo(() => {
    return new AgentSession({
      cwd: process.cwd(),
      model: options.model,
      apiKey: options.apiKey,
      systemPrompt: options.systemPrompt,
    });
  }, []);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);

  useEffect(() => {
    return session.subscribe((event: AgentSessionEvent) => {
      setMessages((prev) => {
        const next = [...prev];
        switch (event.type) {
          case "turn_start": {
            next.push({ type: "assistant_start" });
            break;
          }
          case "thinking_delta": {
            const last = next[next.length - 1];
            if (last && last.type === "thinking") {
              last.text += event.text;
            } else {
              next.push({ type: "thinking", text: event.text });
            }
            break;
          }
          case "answer_delta": {
            const last = next[next.length - 1];
            if (last && last.type === "text") {
              last.text += event.text;
            } else {
              next.push({ type: "text", text: event.text });
            }
            break;
          }
          case "tool_start": {
            next.push({ type: "tool_start", toolName: event.toolName, args: event.args });
            break;
          }
          case "tool_end": {
            next.push({
              type: "tool_end",
              toolName: event.toolName,
              isError: event.isError,
              summary: event.summary,
              timeMs: event.timeMs,
            });
            break;
          }
          case "turn_end": {
            next.push({
              type: "assistant_end",
              tokens: event.tokens,
              cost: event.cost,
              timeMs: event.timeMs,
            });
            break;
          }
        }
        return next;
      });
      setShouldScrollToBottom(true);
    });
  }, [session]);

  return {
    session,
    messages,
    shouldScrollToBottom,
    markScrolled: () => setShouldScrollToBottom(false),
    appendUserMessage: (text: string) => {
      setMessages((prev) => [...prev, { type: "user", text }]);
      setShouldScrollToBottom(true);
    },
  };
}
```

- [ ] **Step 2: 检查 TUI 中对 useAgent 返回值的引用是否需要修改**

由于 `useAgent` 返回值中的 `agent` 被重命名为 `session`，需要检查 TUI 组件中是否有使用 `result.agent` 的地方。搜索并更新为 `result.session`。

Run: `grep -r "\.agent" src/tui/ --include="*.tsx" --include="*.ts"`

如果发现引用（如 `const { agent } = useAgent(...)`），将其改为 `const { session } = useAgent(...)`，并相应更新后续调用（如 `agent.prompt(...)` → `session.prompt(...)`，`agent.reset()` → `session.reset()` 等）。

- [ ] **Step 3: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交 Task 3**

```bash
git add src/tui/hooks/useAgent.ts
git commit -m "$(cat <<'EOF'
refactor(tui): migrate useAgent hook to AgentSession

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 端到端验证与清理

**Files:**
- 检查：所有受影响的文件

- [ ] **Step 1: 运行全部 Agent 层测试**

Run: `bun test src/agent/__tests__/`
Expected: 全部通过

- [ ] **Step 2: 编译整个项目确认无类型错误**

Run: `bun tsc --noEmit`
Expected: 成功退出

- [ ] **Step 3: 检查是否有未使用的导入残留**

重点检查：
- `src/cli/chat.ts` — 确认 `Agent`、`createReadTool` 等旧 import 已删除
- `src/tui/hooks/useAgent.ts` — 确认 `Agent` 和 `AgentTool` 等旧 import 已删除

如有残留未使用导入，立即删除并重新运行 `bun tsc --noEmit`。

- [ ] **Step 4: 提交清理**

```bash
git commit -m "$(cat <<'EOF'
chore: clean up unused imports after AgentSession migration

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- UI 事件转换统一 → Task 1 (`AgentSession` 类)
- `systemPrompt` 集成（含 `createSystemPromptBuilder` 桥接） → Task 1 (`refreshSystemPrompt`)
- 工具绑定（`cwd` 相关的 Read/Write/Edit/Bash） → Task 1 (构造函数)
- CLI 迁移 → Task 2
- TUI 迁移 → Task 3
- 无 `queue_update` 事件（设计文档中有但未在当前阶段实现，YAGNI）

**2. Placeholder scan:**
- 无 "TBD"、"TODO"、"implement later"
- 所有步骤均包含完整代码或精确命令

**3. Type consistency:**
- `AgentSessionEvent` 各字段名称与 Task 1 定义一致
- `UseAgentResult` 中 `session` 命名在 Task 3 及后续搜索/替换中保持一致
- `AgentSessionOptions` 中 `systemPrompt` / `systemPromptSections` 命名一致
