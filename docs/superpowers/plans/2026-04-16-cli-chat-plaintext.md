# CLI Chat 纯文本交互优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/cli/chat.ts` 重构为纯文本、append-only 输出格式，零 ANSI 依赖，完全兼容 pipe 和日志调试。

**Architecture:** 把格式化逻辑提取为 `src/cli/format.ts` 中的纯函数（无状态、无副作用），`chat.ts` 负责事件分发和调用。TTY 和非 TTY 下输出内容完全一致，只是不再做任何颜色或重绘处理。

**Tech Stack:** Bun, TypeScript

**必须遵守的规则：**
- `.claude/rules/code.md`: 最小代码解决问题，只做必要修改，不添加未请求功能
- `.claude/rules/typescript.md`: 结构体优先用 interface，字段加中文注释

---

### 文件结构

- **Create:** `src/cli/format.ts` — 纯文本格式化辅助函数（无状态、无副作用）
- **Create:** `src/cli/__tests__/format.test.ts` — 格式化函数的单元测试
- **Modify:** `src/cli/chat.ts` — 重构 `agent.subscribe()`，调用 format.ts 输出纯文本

---

### Task 1: 纯文本格式化辅助函数

**Files:**
- Create: `src/cli/format.ts`
- Test: `src/cli/__tests__/format.test.ts`

- [ ] **Step 1: 编写失败测试**

创建 `src/cli/__tests__/format.test.ts`：

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
} from "../format.js";

describe("format", () => {
  it("formatUserMessage", () => {
    expect(formatUserMessage("hello")).toBe("\n> hello\n");
  });

  it("formatAICardStart", () => {
    expect(formatAICardStart("test-model")).toBe("Assistant\n---\n");
  });

  it("formatThinkingDelta", () => {
    expect(formatThinkingDelta("think")).toBe("> think");
  });

  it("formatTextDelta", () => {
    expect(formatTextDelta("hi")).toBe("hi");
  });

  it("formatToolStart", () => {
    expect(formatToolStart("read_file", { path: "src/main.ts" })).toBe("\n-> read_file(path: \"src/main.ts\")\n");
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
Expected: FAIL — `Cannot find module '../format.js'`

- [ ] **Step 3: 实现 format.ts**

创建 `src/cli/format.ts`：

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

/** 格式化 thinking 增量 */
export function formatThinkingDelta(delta: string): string {
  return `> ${delta}`;
}

/** 格式化正文增量 */
export function formatTextDelta(delta: string): string {
  return delta;
}

/** 格式化工具开始 */
export function formatToolStart(toolName: string, args: unknown): string {
  return `\n-> ${toolName}${formatToolArgs(args)}\n`;
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
git commit -m "feat(cli): add plaintext formatting helpers and tests"
```

---

### Task 2: 重构 chat.ts 为纯文本输出

**Files:**
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: 重写 chat.ts**

完整替换 `src/cli/chat.ts` 内容：

```typescript
import readline from "readline/promises";
import { Agent } from "../agent/agent.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../tools/index.js";
import {
  formatAICardEnd,
  formatAICardStart,
  formatTextDelta,
  formatThinkingDelta,
  formatToolEnd,
  formatToolStart,
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

agent.subscribe((event) => {
  switch (event.type) {
    case "turn_start": {
      turnStartTime = Date.now();
      process.stdout.write(formatAICardStart(agent.state.model.name));
      break;
    }
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_delta") {
        process.stdout.write(formatThinkingDelta(ae.delta));
      } else if (ae.type === "text_delta") {
        process.stdout.write(formatTextDelta(ae.delta));
      }
      break;
    }
    case "tool_execution_start": {
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_execution_end": {
      const summary = event.isError
        ? String((event.result as any)?.content?.[0]?.text ?? "error")
        : "";
      const elapsed = Date.now() - (event as any).startTime;
      process.stdout.write(formatToolEnd(event.toolName, event.isError, summary || "done", elapsed));
      break;
    }
    case "turn_end": {
      const elapsed = Date.now() - turnStartTime;
      const usage = event.message.usage;
      if (usage) {
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

**注意：** `tool_execution_end` 事件本身没有 `startTime` 字段，需要我们在 `tool_execution_start` 时自己记录。上面的代码里 `(event as any).startTime` 是临时写法，实际上我们应该在 chat.ts 里维护一个 `Map<string, number>` 来记录工具开始时间。正确的实现如下：

```typescript
const toolStartTimes = new Map<string, number>();

agent.subscribe((event) => {
  switch (event.type) {
    // ...
    case "tool_execution_start": {
      toolStartTimes.set(event.toolCallId, Date.now());
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_execution_end": {
      const startTime = toolStartTimes.get(event.toolCallId) ?? Date.now();
      toolStartTimes.delete(event.toolCallId);
      const summary = event.isError
        ? String((event.result as any)?.content?.[0]?.text ?? "error")
        : "";
      const elapsed = Date.now() - startTime;
      process.stdout.write(formatToolEnd(event.toolName, event.isError, summary || "done", elapsed));
      break;
    }
    // ...
  }
});
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: 运行现有 agent 测试**

Run: `bun test src/agent/__tests__/`  
Expected: PASS (不应受 chat.ts 改动影响)

- [ ] **Step 4: Commit**

```bash
git add src/cli/chat.ts
git commit -m "feat(cli): refactor chat.ts to plaintext append-only output"
```

---

### Task 3: Pipe 验证与无 ANSI 断言

**Files:**
- Create: `src/cli/__tests__/chat-pipe.test.ts`

- [ ] **Step 1: 编写 pipe 测试**

创建 `src/cli/__tests__/chat-pipe.test.ts`：

```typescript
import { describe, it, expect } from "bun:test";
import { spawn } from "child_process";
import path from "path";

describe("chat.ts pipe mode", () => {
  it("输出不含 ANSI escape codes", async () => {
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
    expect(stdout).toContain("> /exit");
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `bun test src/cli/__tests__/chat-pipe.test.ts`
Expected: PASS

- [ ] **Step 3: 手动 pipe 验证**

Run:
```bash
perl -e 'alarm 20; exec("bun", "run", "src/cli/chat.ts")' <<'EOF'
hello
/exit
EOF
```

Expected: 输出包含 `Assistant`、`---`、`Tokens:`、`Cost:`，不包含颜色代码或乱码。

- [ ] **Step 4: Commit**

```bash
git add src/cli/__tests__/chat-pipe.test.ts
git commit -m "test(cli): add pipe mode and no-ANSI verification test"
```

---

### Self-Review

**1. Spec coverage：**
- 用户消息格式 → Task 1 `formatUserMessage`
- AI 卡片边框 → Task 1 `formatAICardStart` / `formatAICardEnd`
- thinking 缩进 → Task 1 `formatThinkingDelta`
- 工具执行记录 → Task 1 `formatToolStart` / `formatToolEnd`，Task 2 集成
- 纯文本无 ANSI → Task 3 显式测试
- append-only → Task 2 中所有输出均通过 `process.stdout.write` 追加，无重绘

**2. Placeholder 扫描：**
- 无 "TBD"、"TODO"、"implement later"
- 每个步骤都有完整代码和 exact command
- 无 "add appropriate error handling" 等模糊描述

**3. 类型一致性：**
- 所有 format 函数签名在 Task 1、Task 2 中保持一致
- `formatToolEnd` 参数 `(toolName, isError, summary, timeMs)` 无变化

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-16-cli-chat-plaintext.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
