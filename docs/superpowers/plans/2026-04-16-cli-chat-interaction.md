# CLI Chat 交互优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/cli/chat.ts` 升级为轻量 ANSI 卡片式交互，实现用户消息高亮、AI 回复带边框、thinking 缩进显示、流式光标动画和工具执行可视化。

**Architecture:** 新建 `ChatRenderer` 类集中管理 ANSI 渲染逻辑，`chat.ts` 只负责事件分发和生命周期。TTY 时用 ANSI escape codes 做边框、光标、spinner 重绘；非 TTY 时自动降级为纯文本。工具状态用 `Map` 追踪，spinner 用 `setInterval` 驱动。

**Tech Stack:** Bun, TypeScript, chalk, wrap-ansi

**必须遵守的规则：**
- `.claude/rules/code.md`: 最小代码解决问题，不添加未请求的功能，只做必要修改
- `.claude/rules/typescript.md`: 结构体优先用 interface，字段加中文注释

---

### 文件结构

- **Create:** `src/cli/renderer.ts` — `ChatRenderer` 类，负责所有 ANSI 渲染、边框绘制、光标动画、工具状态
- **Create:** `src/cli/__tests__/renderer.test.ts` — `ChatRenderer` 的单元测试
- **Modify:** `src/cli/chat.ts` — 用 `ChatRenderer` 替换现有的 `agent.subscribe()` 内联输出逻辑

---

### Task 1: ChatRenderer 基础结构与 TTY 检测

**Files:**
- Create: `src/cli/renderer.ts`
- Test: `src/cli/__tests__/renderer.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from "bun:test";
import { ChatRenderer } from "../renderer.js";

describe("ChatRenderer", () => {
  it("初始化时正确检测 TTY 和宽度", () => {
    const renderer = new ChatRenderer({ forceTTY: true, width: 60 });
    // 通过观察输出行为来验证：TTY 模式下用户消息带颜色前缀
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    renderer.printUserMessage("hello");
    console.log = originalLog;
    expect(lines[0]).toContain("> hello");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: FAIL — `Cannot find module '../renderer.js'`

- [ ] **Step 3: 实现 ChatRenderer 基础结构**

```typescript
// src/cli/renderer.ts
import chalk from "chalk";
import wrapAnsi from "wrap-ansi";

export interface ChatRendererOptions {
  /** 强制开启/关闭 TTY 渲染 */
  forceTTY?: boolean;
  /** 终端宽度 */
  width?: number;
}

export class ChatRenderer {
  /** 是否使用 TTY 渲染 */
  private readonly isTTY: boolean;
  /** 终端宽度 */
  private readonly width: number;
  /** 当前模型名称 */
  private modelName: string = "";
  /** thinking 内容缓存 */
  private thinkingText: string = "";
  /** 当前 AI 消息正文缓存 */
  private messageText: string = "";
  /** 当前卡片内容已占用的行数（用于 ANSI 重绘） */
  private contentLineCount: number = 0;
  /** 光标 interval */
  private cursorInterval?: ReturnType<typeof setInterval>;
  /** 当前是否显示了光标 */
  private hasCursor: boolean = false;
  /** 工具执行状态 */
  private toolStates: Map<string, { name: string; args: unknown; startTime: number }> = new Map();
  /** spinner 字符序列 */
  private readonly spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  /** 当前 spinner 索引 */
  private spinnerIndex: number = 0;
  /** spinner interval */
  private spinnerInterval?: ReturnType<typeof setInterval>;

  constructor(options?: ChatRendererOptions) {
    this.isTTY = options?.forceTTY ?? !!process.stdout.isTTY;
    this.width = options?.width ?? (process.stdout.columns || 80);
  }

  /** 打印用户消息 */
  printUserMessage(text: string): void {
    if (this.isTTY) {
      console.log(chalk.cyan.bold(`> ${text}`));
    } else {
      console.log(`> ${text}`);
    }
  }

  /** 隐藏输入提示符（AI 输出期间） */
  hidePrompt(): void {
    if (!this.isTTY) return;
    // 清掉当前行，为后续输出腾出空间
    process.stdout.write("\x1b[2K\r");
  }

  /** 恢复输入提示符 */
  showPrompt(): void {
    if (!this.isTTY) return;
    process.stdout.write("> ");
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/renderer.ts src/cli/__tests__/renderer.test.ts
git commit -m "feat(cli): add ChatRenderer skeleton with TTY detection"
```

---

### Task 2: AI 卡片边框渲染

**Files:**
- Modify: `src/cli/renderer.ts`
- Test: `src/cli/__tests__/renderer.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `src/cli/__tests__/renderer.test.ts` 末尾追加：

```typescript
  it("startAICard 输出顶部边框", () => {
    const renderer = new ChatRenderer({ forceTTY: true, width: 40 });
    const writes: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => writes.push(msg);
    renderer.startAICard("test-model");
    console.log = originalLog;
    expect(writes[0]).toContain("Assistant (test-model)");
    expect(writes[0]).toContain("┌");
    expect(writes[0]).toContain("┐");
  });

  it("endAICard 输出底部边框和元数据", () => {
    const renderer = new ChatRenderer({ forceTTY: true, width: 40 });
    const writes: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => writes.push(msg);
    renderer.endAICard(100, 0.001, 800);
    console.log = originalLog;
    expect(writes[0]).toContain("Tokens: 100");
    expect(writes[0]).toContain("Cost: $0.001000");
    expect(writes[0]).toContain("0.8s");
    expect(writes[0]).toContain("└");
    expect(writes[0]).toContain("┘");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: FAIL — `renderer.startAICard is not a function`

- [ ] **Step 3: 实现边框渲染方法**

在 `ChatRenderer` 中追加以下方法：

```typescript
  /** 开始 AI 回复卡片 */
  startAICard(modelName: string): void {
    if (!this.isTTY) return;
    this.modelName = modelName;
    this.thinkingText = "";
    this.messageText = "";
    this.contentLineCount = 0;
    const title = ` Assistant (${modelName}) `;
    const padding = Math.max(0, this.width - 2 - title.length);
    const line = "─".repeat(padding);
    console.log(chalk.dim(`┌${title}${line}┐`));
  }

  /** 结束 AI 回复卡片 */
  endAICard(tokens: number, cost: number, timeMs: number): void {
    if (!this.isTTY) return;
    this.stopCursor();
    // 清除当前光标后重新绘制最终内容（不带光标）
    this.redrawCardContent(false);
    const timeSec = (timeMs / 1000).toFixed(1);
    const meta = ` Tokens: ${tokens} | Cost: $${cost.toFixed(6)} | ${timeSec}s `;
    const padding = Math.max(0, this.width - 2 - meta.length);
    const line = "─".repeat(padding);
    console.log(chalk.dim(`└${meta}${line}┘`));
  }

  /** 将文本按宽度拆成多行，每行加上左右边框 */
  private renderLines(text: string): string[] {
    const innerWidth = this.width - 2;
    const wrapped = wrapAnsi(text, innerWidth, { trim: false, hard: true });
    return wrapped.split("\n").map((line) => {
      const visibleLen = stripAnsi(line).length;
      const pad = Math.max(0, innerWidth - visibleLen);
      return " " + line + " ".repeat(pad) + " ";
    });
  }
```

同时需要在文件顶部引入 `strip-ansi`：

```typescript
import stripAnsi from "strip-ansi";
```

*注：`strip-ansi` 已在 `package.json` 锁定依赖中。*

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/renderer.ts src/cli/__tests__/renderer.test.ts
git commit -m "feat(cli): add AI card border rendering"
```

---

### Task 3: Thinking 与流式光标动画

**Files:**
- Modify: `src/cli/renderer.ts`
- Test: `src/cli/__tests__/renderer.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `src/cli/__tests__/renderer.test.ts` 末尾追加：

```typescript
  it("appendThinking 输出灰色缩进 thinking 内容", () => {
    const renderer = new ChatRenderer({ forceTTY: true, width: 50 });
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      stdout.push(chunk);
      return true;
    };
    renderer.startAICard("test");
    renderer.appendThinking("thinking");
    process.stdout.write = originalWrite;
    const output = stdout.join("");
    expect(output).toContain("thinking");
  });

  it("startCursor 启动光标并 stopCursor 停止", () => {
    const renderer = new ChatRenderer({ forceTTY: true, width: 50 });
    renderer.startAICard("test");
    renderer.appendText("hi");
    renderer.startCursor();
    // 光标 interval 已启动
    renderer.stopCursor();
    // 不抛异常即通过
    expect(true).toBe(true);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: FAIL — `renderer.appendThinking is not a function`

- [ ] **Step 3: 实现 thinking 和光标动画**

在 `ChatRenderer` 中追加以下方法：

```typescript
  /** 追加 thinking 内容 */
  appendThinking(delta: string): void {
    if (!this.isTTY) return;
    this.thinkingText += delta;
    this.redrawCardContent(true);
  }

  /** 追加正文内容 */
  appendText(delta: string): void {
    if (!this.isTTY) return {
    this.messageText += delta;
    this.redrawCardContent(true);
  }

  /** 启动闪烁光标 */
  startCursor(): void {
    if (!this.isTTY || this.cursorInterval) return;
    this.cursorInterval = setInterval(() => {
      if (this.hasCursor) {
        process.stdout.write("\b \b");
        this.hasCursor = false;
      } else {
        process.stdout.write("▌");
        this.hasCursor = true;
      }
    }, 500);
  }

  /** 停止闪烁光标 */
  stopCursor(): void {
    if (this.cursorInterval) {
      clearInterval(this.cursorInterval);
      this.cursorInterval = undefined;
    }
    if (this.hasCursor) {
      process.stdout.write("\b \b");
      this.hasCursor = false;
    }
  }

  /** 重绘卡片内容区 */
  private redrawCardContent(withCursor: boolean): void {
    // 光标已经在外层 stopCursor 中处理，这里只需重绘内容行
    // 移动光标到内容区顶部
    if (this.contentLineCount > 0) {
      process.stdout.write(`\x1b[${this.contentLineCount}A`);
    }
    // 清除从当前位置到屏幕底部
    process.stdout.write("\x1b[J");

    const lines: string[] = [];
    if (this.thinkingText) {
      const thinkingLines = this.renderLines(
        chalk.gray.italic(this.thinkingText)
      );
      lines.push("", ...thinkingLines, "");
    }
    if (this.messageText) {
      const msgLines = this.renderLines(this.messageText);
      lines.push(...msgLines);
    }

    for (const line of lines) {
      process.stdout.write(chalk.dim("│") + line + chalk.dim("│") + "\n");
    }

    this.contentLineCount = lines.length;

    if (withCursor && !this.cursorInterval) {
      process.stdout.write("▌");
      this.hasCursor = true;
    }
  }
```

修复 `appendText` 的语法错误（上面我写错了，有个 `return {`）：

```typescript
  appendText(delta: string): void {
    if (!this.isTTY) return;
    this.messageText += delta;
    this.redrawCardContent(true);
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/renderer.ts src/cli/__tests__/renderer.test.ts
git commit -m "feat(cli): add thinking display and streaming cursor"
```

---

### Task 4: 工具执行可视化

**Files:**
- Modify: `src/cli/renderer.ts`
- Test: `src/cli/__tests__/renderer.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `src/cli/__tests__/renderer.test.ts` 末尾追加：

```typescript
  it("startTool 和 endTool 渲染工具状态", () => {
    const renderer = new ChatRenderer({ forceTTY: true, width: 60 });
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      stdout.push(chunk);
      return true;
    };
    renderer.startTool("call-1", "read_file", { path: "src/main.ts" });
    renderer.endTool("call-1", false, "1.2KB");
    process.stdout.write = originalWrite;
    const output = stdout.join("");
    expect(output).toContain("read_file");
    expect(output).toContain("1.2KB");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: FAIL — `renderer.startTool is not a function`

- [ ] **Step 3: 实现工具状态渲染**

在 `ChatRenderer` 的 constructor 后追加 spinner interval 初始化：

```typescript
    // 启动全局 spinner interval
    this.spinnerInterval = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerChars.length;
      this.redrawTools();
    }, 100);
```

在 destructor 或清理方法中停止 spinner。由于 TS 没有 destructor，我们加一个 `dispose()` 方法：

```typescript
  /** 清理所有 interval */
  dispose(): void {
    this.stopCursor();
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
  }
```

然后追加工具相关方法：

```typescript
  /** 开始跟踪一个工具执行 */
  startTool(toolCallId: string, toolName: string, args: unknown): void {
    if (!this.isTTY) return;
    this.toolStates.set(toolCallId, { name: toolName, args, startTime: Date.now() });
    this.redrawTools();
  }

  /** 结束一个工具执行 */
  endTool(toolCallId: string, isError: boolean, resultSummary?: string): void {
    if (!this.isTTY) return;
    const state = this.toolStates.get(toolCallId);
    if (!state) return;
    const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
    const summary = resultSummary || "";
    const icon = isError ? chalk.red("❌") : chalk.green("✅");
    const line = `  ${icon} ${this.formatToolLine(state.name, state.args)}  →  ${isError ? chalk.red(summary) : chalk.dim(summary)}  ${chalk.dim(elapsed + "s")}`;
    // 清除旧 spinner 行并打印最终结果
    this.clearToolLines();
    console.log(line);
    this.toolStates.delete(toolCallId);
    // 重新打印剩余仍在执行中的工具
    this.redrawTools();
  }

  /** 格式化工具名和参数 */
  private formatToolLine(name: string, args: unknown): string {
    let argsStr = "";
    if (args && typeof args === "object") {
      const entries = Object.entries(args).slice(0, 2);
      const pairs = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
      argsStr = `(${pairs})`;
    }
    const full = `${name}${argsStr}`;
    if (full.length > 40) {
      return full.slice(0, 37) + "...";
    }
    return full;
  }

  /** 重绘正在执行中的工具状态行 */
  private redrawTools(): void {
    if (!this.isTTY || this.toolStates.size === 0) return;
    this.clearToolLines();
    for (const [, state] of this.toolStates) {
      const spinner = chalk.dim(this.spinnerChars[this.spinnerIndex]);
      const line = `  ${spinner} ${this.formatToolLine(state.name, state.args)}`;
      console.log(line);
    }
  }

  /** 清除已打印的工具状态行（通过光标上移实现） */
  private clearToolLines(): void {
    if (this.toolStates.size === 0) return;
    for (let i = 0; i < this.toolStates.size; i++) {
      process.stdout.write("\x1b[1A\x1b[2K\r");
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/renderer.ts src/cli/__tests__/renderer.test.ts
git commit -m "feat(cli): add tool execution visualization with spinner"
```

---

### Task 5: 集成 ChatRenderer 到 chat.ts

**Files:**
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: 修改 chat.ts 使用 ChatRenderer**

完整替换 `src/cli/chat.ts` 内容：

```typescript
import readline from "readline/promises";
import chalk from "chalk";
import { Agent } from "../agent/agent.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../tools/index.js";
import { ChatRenderer } from "./renderer.js";

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

const renderer = new ChatRenderer();
let turnStartTime = 0;

agent.subscribe((event) => {
  switch (event.type) {
    case "agent_start": {
      renderer.hidePrompt();
      break;
    }
    case "agent_end": {
      renderer.showPrompt();
      break;
    }
    case "turn_start": {
      turnStartTime = Date.now();
      renderer.startAICard(agent.state.model.name);
      break;
    }
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_delta") {
        renderer.appendThinking(ae.delta);
      } else if (ae.type === "text_delta") {
        renderer.appendText(ae.delta);
        renderer.startCursor();
      }
      break;
    }
    case "tool_execution_start": {
      renderer.stopCursor();
      renderer.startTool(event.toolCallId, event.toolName, event.args);
      break;
    }
    case "tool_execution_end": {
      const summary = event.isError
        ? String((event.result as any)?.content?.[0]?.text ?? "error")
        : "";
      renderer.endTool(event.toolCallId, event.isError, summary || undefined);
      break;
    }
    case "turn_end": {
      renderer.stopCursor();
      const elapsed = Date.now() - turnStartTime;
      const usage = event.message.usage;
      if (usage) {
        renderer.endAICard(usage.totalTokens, usage.cost.total, elapsed);
      } else {
        renderer.endAICard(0, 0, elapsed);
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
  if (input === "/new") { agent.reset(); console.log(chalk.dim("Session reset.")); rl.prompt(); return; }
  if (input === "/system") { console.log(agent.state.systemPrompt); rl.prompt(); return; }
  if (input === "/tools") { console.log(agent.state.tools.map((t) => t.name).join(", ")); rl.prompt(); return; }
  if (input === "/messages") { console.log(JSON.stringify(agent.state.messages, null, 2)); rl.prompt(); return; }
  if (input === "/abort") { agent.abort(); rl.prompt(); return; }

  renderer.printUserMessage(input);

  try {
    if (agent.state.isStreaming) {
      agent.steer({ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() });
    } else {
      await agent.prompt(input);
    }
  } catch (err) {
    console.error(chalk.red(`Error: ${err}`));
    renderer.showPrompt();
  }
});
rl.on("close", async () => {
  renderer.dispose();
  await agent.waitForIdle();
  process.exit(0);
});
rl.prompt();
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: 运行 pipe 降级测试**

Run:
```bash
perl -e 'alarm 20; exec("bun", "run", "src/cli/chat.ts")' <<'EOF'
hello
/exit
EOF
```
Expected: 输出包含 `> hello` 和 AI 回复的纯文本（无 ANSI escape codes），正常退出。

- [ ] **Step 4: Commit**

```bash
git add src/cli/chat.ts
git commit -m "feat(cli): integrate ChatRenderer into chat.ts"
```

---

### Task 6: 非 TTY 降级测试

**Files:**
- Test: `src/cli/__tests__/renderer.test.ts`

- [ ] **Step 1: 编写降级测试**

在 `src/cli/__tests__/renderer.test.ts` 末尾追加：

```typescript
  it("非 TTY 模式下不输出 ANSI escape codes", () => {
    const renderer = new ChatRenderer({ forceTTY: false, width: 60 });
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    renderer.printUserMessage("hello");
    renderer.startAICard("test-model");
    renderer.appendThinking("thinking");
    renderer.appendText("hi");
    renderer.startCursor();
    renderer.stopCursor();
    renderer.endAICard(10, 0.0001, 100);
    renderer.startTool("t1", "read_file", { path: "x" });
    renderer.endTool("t1", false, "done");
    console.log = originalLog;

    const output = lines.join("\n");
    // ANSI escape code 通常以 \x1b 开头
    expect(output).not.toContain("\x1b");
    expect(output).toContain("> hello");
    expect(output).toContain("hi");
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `bun test src/cli/__tests__/renderer.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/__tests__/renderer.test.ts
git commit -m "test(cli): add non-TTY fallback test for ChatRenderer"
```

---

### Self-Review

**1. Spec coverage：**
- 消息布局（A）→ Task 1 + Task 2 实现用户消息高亮和 AI 卡片边框
- 流式反馈（B）→ Task 3 实现 thinking 缩进和光标动画
- 工具可视化（C）→ Task 4 实现 spinner 和结果状态
- TTY 降级 → Task 6 显式测试

**2. Placeholder 扫描：**
- 无 "TBD"、"TODO"、"implement later"
- 每个步骤都有完整代码和 exact command
- 无 "add appropriate error handling" 等模糊描述

**3. 类型一致性：**
- `ChatRenderer` 类名、方法名（`startAICard`, `endAICard`, `appendThinking`, `appendText`, `startCursor`, `stopCursor`, `startTool`, `endTool`, `dispose`）在所有任务中保持一致
- `forceTTY` 和 `width` 构造参数在所有测试和实现中保持一致

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-16-cli-chat-interaction.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
