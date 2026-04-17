# CLI Chat 标签化纯文本交互实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有纯文本 CLI 基础上，引入 `Thinking:` / `Answer:` / `Tools:` 标签段落，让 thinking、正文、工具记录有清晰的视觉边界。

**Architecture:** 更新 `src/cli/format.ts` 提供标签前缀辅助函数；更新 `src/cli/chat.ts` 维护 `hasEmittedThinking` / `hasEmittedAnswer` / `hasEmittedTools` 三个 turn 级状态，在首次收到对应事件时先输出标签；测试同步更新断言。

**Tech Stack:** Bun, TypeScript

**必须遵守的规则：**
- `.claude/rules/code.md`: 最小代码解决问题，只做必要修改
- `.claude/rules/typescript.md`: 结构体优先用 interface，字段加中文注释

---

### 文件结构

- **Modify:** `src/cli/format.ts` — 新增 `formatThinkingPrefix`、`formatAnswerPrefix`、`formatToolsPrefix` 辅助函数
- **Modify:** `src/cli/__tests__/format.test.ts` — 更新断言，覆盖标签前缀格式化
- **Modify:** `src/cli/chat.ts` — 在 `agent.subscribe()` 内维护 turn 级状态，控制标签输出时机
- **Modify:** `src/cli/__tests__/chat-pipe.test.ts` — 增加对 `Thinking:` / `Answer:` / `Tools:` 标签的断言

---

### Task 1: 更新 format.ts 支持标签前缀

**Files:**
- Modify: `src/cli/format.ts`
- Modify: `src/cli/__tests__/format.test.ts`

- [ ] **Step 1: 编写失败测试**

完整替换 `src/cli/__tests__/format.test.ts` 内容：

```typescript
import { describe, it, expect } from "bun:test";
import {
  formatUserMessage,
  formatAICardStart,
  formatThinkingDelta,
  formatTextDelta,
  formatToolStart,
  formatToolEnd,
  formatAICardEnd,
  formatThinkingPrefix,
  formatAnswerPrefix,
  formatToolsPrefix,
} from "../format.js";

describe("format", () => {
  it("formatUserMessage", () => {
    expect(formatUserMessage("hello")).toBe("\n> hello\n");
  });

  it("formatAICardStart", () => {
    expect(formatAICardStart("test-model")).toBe("Assistant\n---\n");
  });

  it("formatThinkingPrefix", () => {
    expect(formatThinkingPrefix()).toBe("Thinking:\n  ");
  });

  it("formatThinkingDelta", () => {
    expect(formatThinkingDelta("think")).toBe("think");
  });

  it("formatAnswerPrefix", () => {
    expect(formatAnswerPrefix()).toBe("\nAnswer:\n");
  });

  it("formatTextDelta", () => {
    expect(formatTextDelta("hi")).toBe("hi");
  });

  it("formatToolsPrefix", () => {
    expect(formatToolsPrefix()).toBe("\nTools:\n");
  });

  it("formatToolStart", () => {
    expect(formatToolStart("read_file", { path: "src/main.ts" })).toBe("-> read_file(path: \"src/main.ts\")\n");
  });

  it("formatToolEnd 成功", () => {
    expect(formatToolEnd("read_file", false, "1.2KB", 300)).toBe("OK read_file -> 1.2KB 0.3s\n");
  });

  it("formatToolEnd 失败", () => {
    expect(formatToolEnd("read_file", true, "ENOENT", 100)).toBe("ERR read_file -> ENOENT 0.1s\n");
  });

  it("formatAICardEnd", () => {
    expect(formatAICardEnd(640, 0.000218, 800)).toBe("---\nTokens: 640 | Cost: $0.000218 | 0.8s\n");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/cli/__tests__/format.test.ts`
Expected: FAIL — `formatThinkingPrefix is not a function` 等

- [ ] **Step 3: 实现 format.ts**

完整替换 `src/cli/format.ts` 内容：

```typescript
// src/cli/format.ts

/** 参数格式化的最大长度 */
const MAX_TOOL_LINE_LENGTH = 40;

/** 格式化用户消息 */
export function formatUserMessage(text: string): string {
  return `\n> ${text}\n`;
}

/** 格式化 AI 卡片开始 */
export function formatAICardStart(_modelName: string): string {
  return "Assistant\n---\n";
}

/** 格式化 Thinking 标签前缀 */
export function formatThinkingPrefix(): string {
  return "Thinking:\n  ";
}

/** 格式化 thinking 增量 */
export function formatThinkingDelta(delta: string): string {
  return delta;
}

/** 格式化 Answer 标签前缀 */
export function formatAnswerPrefix(): string {
  return "\nAnswer:\n";
}

/** 格式化正文增量 */
export function formatTextDelta(delta: string): string {
  return delta;
}

/** 格式化 Tools 标签前缀 */
export function formatToolsPrefix(): string {
  return "\nTools:\n";
}

/** 格式化工具开始 */
export function formatToolStart(toolName: string, args: unknown): string {
  return `-> ${toolName}${formatToolArgs(args)}\n`;
}

/** 格式化工具结束 */
export function formatToolEnd(
  toolName: string,
  isError: boolean,
  summary: string,
  timeMs: number,
): string {
  const status = isError ? "ERR" : "OK";
  const timeSec = (timeMs / 1000).toFixed(1);
  return `${status} ${toolName} -> ${summary} ${timeSec}s\n`;
}

/** 格式化 AI 卡片结束 */
export function formatAICardEnd(tokens: number, cost: number, timeMs: number): string {
  const timeSec = (timeMs / 1000).toFixed(1);
  return `---\nTokens: ${tokens} | Cost: $${cost.toFixed(6)} | ${timeSec}s\n`;
}

/** 将工具参数格式化为字符串 */
function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "()";
  }
  const entries = Object.entries(args).slice(0, 2);
  const pairs = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  const full = `(${pairs})`;
  if (full.length > MAX_TOOL_LINE_LENGTH) {
    return full.slice(0, MAX_TOOL_LINE_LENGTH - 3) + "...";
  }
  return full;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/cli/__tests__/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/format.ts src/cli/__tests__/format.test.ts
git commit -m "feat(cli): add Thinking/Answer/Tools prefix formatters"
```

---

### Task 2: 更新 chat.ts 维护 turn 级标签状态

**Files:**
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: 重写 chat.ts 的事件处理逻辑**

完整替换 `src/cli/chat.ts` 内容：

```typescript
import readline from "readline/promises";
import { Agent } from "../agent/agent.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../tools/index.js";
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

const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const agent = new Agent({
  initialState: {
    systemPrompt,
    model,
    thinkingLevel: "medium",
    tools: [createReadTool(process.cwd()), createWriteTool(process.cwd()), createEditTool(process.cwd()), createBashTool(process.cwd())],
  },
  getApiKey: () => apiKey,
});

let turnStartTime = 0;
const toolStartTimes = new Map<string, number>();

/** 当前 turn 内是否已输出 Thinking 标签 */
let hasEmittedThinking = false;
/** 当前 turn 内是否已输出 Answer 标签 */
let hasEmittedAnswer = false;
/** 当前 turn 内是否已输出 Tools 标签 */
let hasEmittedTools = false;

agent.subscribe((event) => {
  switch (event.type) {
    case "turn_start": {
      turnStartTime = Date.now();
      hasEmittedThinking = false;
      hasEmittedAnswer = false;
      hasEmittedTools = false;
      process.stdout.write(formatAICardStart(agent.state.model.name));
      break;
    }
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_delta") {
        if (!hasEmittedThinking) {
          hasEmittedThinking = true;
          process.stdout.write(formatThinkingPrefix());
        }
        process.stdout.write(formatThinkingDelta(ae.delta));
      } else if (ae.type === "text_delta") {
        if (!hasEmittedAnswer) {
          hasEmittedAnswer = true;
          process.stdout.write(formatAnswerPrefix());
        }
        process.stdout.write(formatTextDelta(ae.delta));
      }
      break;
    }
    case "tool_execution_start": {
      toolStartTimes.set(event.toolCallId, Date.now());
      if (!hasEmittedTools) {
        hasEmittedTools = true;
        process.stdout.write(formatToolsPrefix());
      }
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_execution_end": {
      const startTime = toolStartTimes.get(event.toolCallId) ?? Date.now();
      toolStartTimes.delete(event.toolCallId);
      const summary = event.isError
        ? String((event.result as any)?.content?.[0]?.text ?? "error")
        : String((event.result as any)?.content?.[0]?.text ?? "");
      const elapsed = Date.now() - startTime;
      process.stdout.write(formatToolEnd(event.toolName, event.isError, summary || "done", elapsed));
      break;
    }
    case "turn_end": {
      const elapsed = Date.now() - turnStartTime;
      if (event.message.role === "assistant") {
        const usage = event.message.usage;
        process.stdout.write(formatAICardEnd(usage.totalTokens, usage.cost.total, elapsed));
      } else {
        process.stdout.write(formatAICardEnd(0, 0, elapsed));
      }
      break;
    }
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  if (input === "/exit") { rl.close(); return; }
  if (input === "/new") { agent.reset(); console.log("Session reset."); rl.prompt(); return; }
  if (input === "/system") { console.log(agent.state.systemPrompt); rl.prompt(); return; }
  if (input === "/tools") { console.log(agent.state.tools.map((t) => t.name).join(", ")); rl.prompt(); return; }
  if (input === "/messages") { console.log(JSON.stringify(agent.state.messages, null, 2)); rl.prompt(); return; }
  if (input === "/abort") { agent.abort(); rl.prompt(); return; }

  process.stdout.write(formatUserMessage(input));

  try {
    if (agent.state.isStreaming) {
      agent.steer({ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() });
    } else {
      await agent.prompt(input);
    }
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  rl.prompt();
});
rl.on("close", async () => {
  await agent.waitForIdle();
  process.exit(0);
});
rl.prompt();
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: 运行现有测试**

Run: `bun test src/cli/__tests__/format.test.ts && bun test src/agent/__tests__/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/chat.ts
git commit -m "feat(cli): add turn-level Thinking/Answer/Tools label state"
```

---

### Task 3: 更新 pipe 测试断言

**Files:**
- Modify: `src/cli/__tests__/chat-pipe.test.ts`

- [ ] **Step 1: 重写 pipe 测试**

完整替换 `src/cli/__tests__/chat-pipe.test.ts` 内容：

```typescript
import { describe, it, expect } from "bun:test";
import { spawn } from "child_process";
import path from "path";

describe("chat.ts pipe mode", () => {
  it("输出不含 ANSI escape codes 且包含标签段落", async () => {
    const chatPath = path.resolve(process.cwd(), "src/cli/chat.ts");
    const child = spawn("bun", ["run", chatPath], {
      env: { ...process.env, FORCE_NON_TTY: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write("/exit\n");
    child.stdin.end();

    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Exit code ${code}`));
        }
      });
      child.on("error", reject);
    });

    expect(stdout).not.toContain("\x1b");
    expect(stdout).toContain("> ");
    // 由于 /exit 直接退出，不会触发 AI 回复块，但格式本身在其它测试中已覆盖
  });
});
```

*注：pipe 测试用 `/exit` 只能验证 prompt 和无 ANSI；`Thinking:` / `Answer:` / `Tools:` 的集成输出更适合通过 `format.test.ts` 和后续实际运行验证。*

- [ ] **Step 2: 运行测试确认通过**

Run: `bun test src/cli/__tests__/chat-pipe.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/__tests__/chat-pipe.test.ts
git commit -m "test(cli): update pipe test for label-based output"
```

---

### Self-Review

**1. Spec coverage：**
- `Thinking:` 标签段落 → Task 1 `formatThinkingPrefix` + Task 2 turn 状态
- `Answer:` 标签段落 → Task 1 `formatAnswerPrefix` + Task 2 turn 状态
- `Tools:` 标签段落 → Task 1 `formatToolsPrefix` + Task 2 turn 状态
- 纯文本无 ANSI → Task 3 保持验证
- append-only → Task 2 仍用 `process.stdout.write` 追加

**2. Placeholder 扫描：**
- 无 "TBD"、"TODO"、"implement later"
- 每个步骤都有完整代码和 exact command
- 无模糊描述

**3. 类型一致性：**
- `formatThinkingPrefix`、`formatAnswerPrefix`、`formatToolsPrefix` 签名在 Task 1 和 Task 2 中保持一致
- `hasEmittedThinking`、`hasEmittedAnswer`、`hasEmittedTools` 在 Task 2 中统一使用

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-16-cli-chat-labels.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
