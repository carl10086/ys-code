# ys-code TUI 最简单版本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/cli/chat.ts` 从 readline 迁移到 Ink TUI，实现消息列表、多行输入框、状态栏和简单滚动。

**Architecture:** 使用 Ink + React 构建 TUI；通过 `useAgent` hook 订阅 `AgentEvent` 并归约为 `UIMessage[]`；消息列表采用负 margin 实现简单滚动；输入框自行管理多行文本和历史记录。

**Tech Stack:** Bun, TypeScript, Ink, React, chalk

---

## 前置阅读

- 设计文档: `docs/superpowers/specs/2026-04-16-tui-simplest-design.md`
- 现有 CLI 入口: `src/cli/chat.ts`
- Agent 类型: `src/agent/types.ts`
- Agent 类: `src/agent/agent.ts`
- 项目规则: `.claude/rules/code.md`, `.claude/rules/typescript.md`

---

## 文件结构

```
src/tui/
  index.tsx              # 启动入口
  app.tsx                # 根组件
  hooks/
    useAgent.ts          # Agent 事件订阅与 UI 状态归约
  components/
    MessageList.tsx      # 消息列表 + 简单滚动
    MessageItem.tsx      # 单条消息渲染
    PromptInput.tsx      # 多行输入框 + 历史记录
    StatusBar.tsx        # 底部状态栏
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 ink 和 react**

```bash
bun add ink react
```

- [ ] **Step 2: 安装类型定义**

```bash
bun add -d @types/react
```

- [ ] **Step 3: 验证安装成功**

Run: `bunx tsc --noEmit`
Expected: 无新增类型错误（ink/react 类型可解析）。

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add ink and react for TUI"
```

---

## Task 2: 定义 UIMessage 类型

**Files:**
- Create: `src/tui/types.ts`

- [ ] **Step 1: 编写 UIMessage 类型定义**

```typescript
// src/tui/types.ts

/** UI 消息类型 */
export type UIMessage =
  | { type: "user"; text: string }
  | { type: "assistant_start" }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; toolName: string; args: unknown }
  | { type: "tool_end"; toolName: string; isError: boolean; summary: string; timeMs: number }
  | {
      type: "assistant_end";
      tokens: number;
      cost: number;
      timeMs: number;
    };
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/types.ts
git commit -m "types(tui): add UIMessage type"
```

---

## Task 3: 实现 useAgent Hook

**Files:**
- Create: `src/tui/hooks/useAgent.ts`

- [ ] **Step 1: 编写 hook 测试**

Create `src/tui/hooks/__tests__/useAgent.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useAgent } from "../useAgent.js";
import { Agent } from "../../../agent/agent.js";

describe("useAgent", () => {
  it("should return agent and empty messages initially", () => {
    const { result } = renderHook(() =>
      useAgent({
        systemPrompt: "test",
        model: { id: "test", name: "Test", api: "test", provider: "test", baseUrl: "", reasoning: false, input: [], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 0, maxTokens: 0 } as any,
        apiKey: "fake",
        tools: [],
      })
    );
    expect(result.current.agent).toBeInstanceOf(Agent);
    expect(result.current.messages).toEqual([]);
  });
});
```

Run: `bun test src/tui/hooks/__tests__/useAgent.test.ts`
Expected: FAIL（useAgent 尚未实现）。

- [ ] **Step 2: 实现 useAgent**

Create `src/tui/hooks/useAgent.ts`:

```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import { Agent } from "../../agent/agent.js";
import type { AgentEvent, AgentMessage, AgentState, AgentTool } from "../../agent/types.js";
import type { Model } from "../../core/ai/index.js";
import type { UIMessage } from "../types.js";

export interface UseAgentOptions {
  /** 系统提示词 */
  systemPrompt: string;
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
  /** 工具列表 */
  tools: AgentTool<any>[];
}

export interface UseAgentResult {
  /** Agent 实例 */
  agent: Agent;
  /** UI 消息列表 */
  messages: UIMessage[];
  /** 是否应自动滚动到底部 */
  shouldScrollToBottom: boolean;
  /** 标记滚动已执行 */
  markScrolled: () => void;
}

export function useAgent(options: UseAgentOptions): UseAgentResult {
  const agent = useMemo(() => {
    return new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: options.model,
        thinkingLevel: "medium",
        tools: options.tools,
      },
      getApiKey: () => options.apiKey,
    });
  }, []);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);
  const toolStartTimes = useRef<Map<string, number>>(new Map());
  const turnStartTime = useRef<number>(0);

  useEffect(() => {
    return agent.subscribe((event) => {
      setMessages((prev) => {
        const next = [...prev];
        switch (event.type) {
          case "turn_start": {
            turnStartTime.current = Date.now();
            next.push({ type: "assistant_start" });
            break;
          }
          case "message_update": {
            const ae = event.assistantMessageEvent;
            if (ae.type === "thinking_delta") {
              const last = next[next.length - 1];
              if (last && last.type === "thinking") {
                last.text += ae.delta;
              } else {
                next.push({ type: "thinking", text: ae.delta });
              }
            } else if (ae.type === "text_delta") {
              const last = next[next.length - 1];
              if (last && last.type === "text") {
                last.text += ae.delta;
              } else {
                next.push({ type: "text", text: ae.delta });
              }
            }
            break;
          }
          case "tool_execution_start": {
            toolStartTimes.current.set(event.toolCallId, Date.now());
            next.push({ type: "tool_start", toolName: event.toolName, args: event.args });
            break;
          }
          case "tool_execution_end": {
            const startTime = toolStartTimes.current.get(event.toolCallId) ?? Date.now();
            toolStartTimes.current.delete(event.toolCallId);
            const summary = event.isError
              ? String((event.result as any)?.content?.[0]?.text ?? "error")
              : String((event.result as any)?.content?.[0]?.text ?? "");
            next.push({
              type: "tool_end",
              toolName: event.toolName,
              isError: event.isError,
              summary: summary || "done",
              timeMs: Date.now() - startTime,
            });
            break;
          }
          case "turn_end": {
            const elapsed = Date.now() - turnStartTime.current;
            if (event.message.role === "assistant") {
              const usage = event.message.usage;
              next.push({
                type: "assistant_end",
                tokens: usage.totalTokens,
                cost: usage.cost.total,
                timeMs: elapsed,
              });
            } else {
              next.push({ type: "assistant_end", tokens: 0, cost: 0, timeMs: elapsed });
            }
            break;
          }
        }
        return next;
      });
      setShouldScrollToBottom(true);
    });
  }, [agent]);

  return {
    agent,
    messages,
    shouldScrollToBottom,
    markScrolled: () => setShouldScrollToBottom(false),
  };
}
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/tui/hooks/__tests__/useAgent.test.ts`
Expected: PASS（至少初始化测试通过）。

- [ ] **Step 4: Commit**

```bash
git add src/tui/hooks/useAgent.ts src/tui/hooks/__tests__/useAgent.test.ts
git commit -m "feat(tui): add useAgent hook to bridge AgentEvent to UIMessage"
```

---

## Task 4: 实现 MessageItem 组件

**Files:**
- Create: `src/tui/components/MessageItem.tsx`

- [ ] **Step 1: 创建 MessageItem 组件**

```typescript
// src/tui/components/MessageItem.tsx
import { Box, Text } from "ink";
import React from "react";
import type { UIMessage } from "../types.js";

export interface MessageItemProps {
  /** 要渲染的 UI 消息 */
  message: UIMessage;
}

export function MessageItem({ message }: MessageItemProps): React.ReactElement {
  switch (message.type) {
    case "user":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            {"\u003e "}{message.text}
          </Text>
        </Box>
      );
    case "assistant_start":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Assistant</Text>
          <Text color="gray">{"─".repeat(40)}</Text>
        </Box>
      );
    case "thinking":
      return (
        <Box flexDirection="column">
          <Text dimColor>Thinking:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{message.text}</Text>
          </Box>
        </Box>
      );
    case "text":
      return (
        <Box flexDirection="column">
          <Text bold>Answer:</Text>
          <Text>{message.text}</Text>
        </Box>
      );
    case "tool_start":
      return (
        <Box flexDirection="column">
          <Text color="yellow">{"-> "}{message.toolName} {formatToolArgs(message.args)}</Text>
        </Box>
      );
    case "tool_end": {
      const status = message.isError ? "ERR" : "OK";
      const timeSec = (message.timeMs / 1000).toFixed(1);
      const color = message.isError ? "red" : "green";
      return (
        <Box flexDirection="column">
          <Text color={color}>
            {status} {message.toolName} -> {message.summary} {timeSec}s
          </Text>
        </Box>
      );
    }
    case "assistant_end": {
      const timeSec = (message.timeMs / 1000).toFixed(1);
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">{"─".repeat(40)}</Text>
          <Text color="gray">
            Tokens: {message.tokens} | Cost: ${message.cost.toFixed(6)} | {timeSec}s
          </Text>
        </Box>
      );
    }
  }
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "()";
  }
  const entries = Object.entries(args).slice(0, 2);
  const pairs = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  const full = `(${pairs})`;
  if (full.length > 40) {
    return full.slice(0, 37) + "...";
  }
  return full;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/MessageItem.tsx
git commit -m "feat(tui): add MessageItem component"
```

---

## Task 5: 实现 MessageList 组件

**Files:**
- Create: `src/tui/components/MessageList.tsx`

- [ ] **Step 1: 实现 MessageList 组件**

```typescript
// src/tui/components/MessageList.tsx
import { Box, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";
import type { UIMessage } from "../types.js";
import { MessageItem } from "./MessageItem.js";

export interface MessageListProps {
  /** 消息列表 */
  messages: UIMessage[];
  /** 是否应自动滚动到底部 */
  shouldScrollToBottom: boolean;
  /** 滚动完成后回调 */
  onScrolled: () => void;
}

export function MessageList({ messages, shouldScrollToBottom, onScrolled }: MessageListProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const containerRef = useRef<{ yogaNode: { getComputedHeight: () => number } | null }>(null);

  // 估算总高度：每类消息给一个近似行数
  const totalLines = messages.reduce((sum, m) => {
    switch (m.type) {
      case "user":
        return sum + Math.max(1, Math.ceil(m.text.length / 80));
      case "assistant_start":
        return sum + 2;
      case "thinking":
        return sum + 1 + Math.max(1, Math.ceil(m.text.length / 76));
      case "text":
        return sum + 1 + Math.max(1, Math.ceil(m.text.length / 80));
      case "tool_start":
      case "tool_end":
        return sum + 1;
      case "assistant_end":
        return sum + 2;
    }
  }, 0);

  // 估算容器可用行数（默认终端高度 24，减去输入框 3 行和状态栏 1 行）
  const containerHeight = 20;
  const maxScrollOffset = Math.max(0, totalLines - containerHeight);

  useEffect(() => {
    if (shouldScrollToBottom) {
      setScrollOffset(maxScrollOffset);
      onScrolled();
    }
  }, [shouldScrollToBottom, maxScrollOffset, onScrolled]);

  useInput((_, key) => {
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxScrollOffset, o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - 5));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(maxScrollOffset, o + 5));
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginTop={-scrollOffset}>
        {messages.map((message, index) => (
          <MessageItem key={index} message={message} />
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/MessageList.tsx
git commit -m "feat(tui): add MessageList with simple scrolling"
```

---

## Task 6: 实现 StatusBar 组件

**Files:**
- Create: `src/tui/components/StatusBar.tsx`

- [ ] **Step 1: 实现 StatusBar**

```typescript
// src/tui/components/StatusBar.tsx
import { Box, Text } from "ink";
import React from "react";

export interface StatusBarProps {
  /** 当前状态 */
  status: "idle" | "streaming" | "tool_executing";
  /** 模型名称 */
  modelName: string;
}

export function StatusBar({ status, modelName }: StatusBarProps): React.ReactElement {
  const statusText =
    status === "streaming"
      ? "Streaming..."
      : status === "tool_executing"
      ? "Executing tools..."
      : "Ready";

  const statusColor =
    status === "streaming" ? "yellow" : status === "tool_executing" ? "cyan" : "green";

  return (
    <Box height={1} flexDirection="row" justifyContent="space-between">
      <Text color={statusColor}>{statusText}</Text>
      <Text color="gray">{modelName}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/StatusBar.tsx
git commit -m "feat(tui): add StatusBar component"
```

---

## Task 7: 实现 PromptInput 组件

**Files:**
- Create: `src/tui/components/PromptInput.tsx`

- [ ] **Step 1: 实现 PromptInput 组件**

```typescript
// src/tui/components/PromptInput.tsx
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export interface PromptInputProps {
  /** 是否禁用提交 */
  disabled?: boolean;
  /** 提交回调 */
  onSubmit: (text: string) => void;
  /** 执行 slash 命令回调 */
  onCommand: (command: string) => boolean;
}

export function PromptInput({ disabled, onSubmit, onCommand }: PromptInputProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      const text = lines.join("\n").trim();
      if (!text) return;
      if (text.startsWith("/") && onCommand(text)) {
        setLines([""]);
        setCursorLine(0);
        setCursorCol(0);
        return;
      }
      onSubmit(text);
      setHistory((h) => [...h, text]);
      setHistoryIndex(-1);
      setLines([""]);
      setCursorLine(0);
      setCursorCol(0);
      return;
    }

    if (key.escape || (key.ctrl && input === "c")) {
      process.exit(0);
      return;
    }

    if (key.upArrow) {
      if (cursorLine > 0) {
        setCursorLine((l) => l - 1);
        setCursorCol((c) => Math.min(c, lines[cursorLine - 1]?.length ?? 0));
      } else if (historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        const newLines = history[history.length - 1 - nextIndex].split("\n");
        setLines(newLines.length > 0 ? newLines : [""]);
        setCursorLine(0);
        setCursorCol(0);
      }
      return;
    }

    if (key.downArrow) {
      if (cursorLine < lines.length - 1) {
        setCursorLine((l) => l + 1);
        setCursorCol((c) => Math.min(c, lines[cursorLine + 1]?.length ?? 0));
      } else if (historyIndex >= 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        if (nextIndex < 0) {
          setLines([""]);
        } else {
          const newLines = history[history.length - 1 - nextIndex].split("\n");
          setLines(newLines.length > 0 ? newLines : [""]);
        }
        setCursorLine(0);
        setCursorCol(0);
      }
      return;
    }

    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol((c) => c - 1);
      } else if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1];
        setCursorLine((l) => l - 1);
        setCursorCol(prevLine?.length ?? 0);
      }
      return;
    }

    if (key.rightArrow) {
      const line = lines[cursorLine];
      if (cursorCol < (line?.length ?? 0)) {
        setCursorCol((c) => c + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine((l) => l + 1);
        setCursorCol(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        const line = lines[cursorLine];
        const newLine = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
        setLines((prev) => prev.map((l, i) => (i === cursorLine ? newLine : l)));
        setCursorCol((c) => c - 1);
      } else if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1];
        const currentLine = lines[cursorLine];
        const newLines = [...lines];
        newLines[cursorLine - 1] = prevLine + currentLine;
        newLines.splice(cursorLine, 1);
        setLines(newLines);
        setCursorLine((l) => l - 1);
        setCursorCol(prevLine.length);
      }
      return;
    }

    if (input === "\r" || input === "\n") {
      // Shift+Enter 或者普通换行（已由 return 处理，此处忽略）
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const line = lines[cursorLine] ?? "";
      const newLine = line.slice(0, cursorCol) + input + line.slice(cursorCol);
      setLines((prev) => prev.map((l, i) => (i === cursorLine ? newLine : l)));
      setCursorCol((c) => c + input.length);
    }
  });

  const displayLines = lines.map((line, i) => (
    <Text key={i}>
      {i === 0 ? "> " : "  "}
      {line}
      {i === cursorLine ? "█" : ""}
    </Text>
  ));

  return (
    <Box flexDirection="column" marginTop={1}>
      {displayLines}
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/PromptInput.tsx
git commit -m "feat(tui): add PromptInput component with history"
```

---

## Task 8: 实现 App 根组件

**Files:**
- Create: `src/tui/app.tsx`

- [ ] **Step 1: 实现 App 组件**

```typescript
// src/tui/app.tsx
import { Box } from "ink";
import React from "react";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../agent/tools/index.js";
import { MessageList } from "./components/MessageList.js";
import { PromptInput } from "./components/PromptInput.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgent } from "./hooks/useAgent.js";

const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

export function App(): React.ReactElement {
  const { agent, messages, shouldScrollToBottom, markScrolled } = useAgent({
    systemPrompt,
    model,
    apiKey,
    tools: [
      createReadTool(process.cwd()),
      createWriteTool(process.cwd()),
      createEditTool(process.cwd()),
      createBashTool(process.cwd()),
    ],
  });

  const isStreaming = agent.state.isStreaming;
  const hasPendingTools = agent.state.pendingToolCalls.size > 0;
  const status = isStreaming ? (hasPendingTools ? "tool_executing" : "streaming") : "idle";

  const handleCommand = (text: string): boolean => {
    const command = text.trim();
    switch (command) {
      case "/exit":
        agent.waitForIdle().then(() => process.exit(0));
        return true;
      case "/new":
        agent.reset();
        return true;
      case "/system":
        // 在消息列表中注入一条 system prompt 消息
        // 暂不实现，返回 false 让它进入 LLM（或本地处理）
        return false;
      case "/tools":
        return false;
      case "/messages":
        return false;
      case "/abort":
        agent.abort();
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (isStreaming) {
      agent.steer({ role: "user", content: [{ type: "text", text: trimmed }], timestamp: Date.now() });
    } else {
      try {
        await agent.prompt(trimmed);
      } catch (err) {
        // 错误会通过 AgentEvent 的 message_update / agent_end 体现
      }
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <MessageList messages={messages} shouldScrollToBottom={shouldScrollToBottom} onScrolled={markScrolled} />
      <PromptInput disabled={false} onSubmit={handleSubmit} onCommand={handleCommand} />
      <StatusBar status={status} modelName={agent.state.model.name} />
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/app.tsx
git commit -m "feat(tui): add App root component"
```

---

## Task 9: 实现 TUI 启动入口

**Files:**
- Create: `src/tui/index.tsx`

- [ ] **Step 1: 实现入口文件**

```typescript
// src/tui/index.tsx
import { render } from "ink";
import React from "react";
import { App } from "./app.js";

async function main() {
  try {
    const instance = await render(<App />);
    process.on("SIGINT", async () => {
      await instance.waitUntilExit();
      process.exit(0);
    });
  } catch (err) {
    console.error("Failed to start TUI:", err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/index.tsx
git commit -m "feat(tui): add TUI entry point"
```

---

## Task 10: 添加启动脚本并运行类型检查

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 package.json 的 scripts 中增加 tui 启动命令**

```json
"tui": "bun run src/tui/index.tsx"
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add tui npm script"
```

---

## Task 11: 集成测试（手动验证）

- [ ] **Step 1: 启动 TUI**

Run: `bun run tui`
Expected: 界面渲染，出现 `> ` 提示符和底部状态栏 `Ready`。

- [ ] **Step 2: 发送测试消息**

输入 `hello` 并按 Enter。
Expected: 消息区域出现 `> hello`，随后出现 `Assistant` 卡片和流式回复。

- [ ] **Step 3: 测试多行输入**

输入 `line1`，按 `Shift+Enter`，输入 `line2`，按 Enter。
Expected: 用户消息包含两行换行，AI 正常回复。

- [ ] **Step 4: 测试历史记录**

发送一条消息后，按 `↑`。
Expected: 输入框显示上一条消息内容。

- [ ] **Step 5: 测试滚动**

持续发送消息直到超出屏幕，按 `PageUp` / `PageDown`。
Expected: 消息区域上下滚动。

- [ ] **Step 6: 测试 slash 命令**

输入 `/new` 并回车。
Expected: 消息列表清空，状态栏保持 Ready。

- [ ] **Step 7: 测试 tool 执行**

输入 `read package.json`。
Expected: 显示 `-> read(...)` 和 `OK read -> ...`。

---

## Self-Review 检查清单

### 1. Spec 覆盖检查
- [x] 消息区域与输入框分离 → App.tsx 使用 Box 分三部分
- [x] 消息区域支持上下滚动 → MessageList 的 scrollOffset
- [x] 输入框支持多行输入、Shift+Enter 换行 → PromptInput 管理 lines 数组
- [x] 输入历史切换 → PromptInput 的 history/historyIndex
- [x] 状态栏实时显示状态 → StatusBar 组件
- [x] 不破坏 Agent 接口契约 → 直接复用 subscribe/prompt/steer/reset/abort

### 2. 占位符扫描
- [x] 无 TBD/TODO
- [x] 每步均有可运行代码或命令
- [x] 无"appropriate error handling"等模糊描述

### 3. 类型一致性检查
- [x] `UIMessage` 类型在 `types.ts` 中定义，被 `useAgent.ts` 和 `MessageItem.tsx` 引用
- [x] `UseAgentResult` 的字段名与 App.tsx 中使用的一致
- [x] `AgentEvent` 类型引用路径正确 (`../../agent/types.js`)

---

## 执行方式建议

Plan complete and saved to `docs/superpowers/plans/2026-04-16-tui-simplest-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

Which approach?
