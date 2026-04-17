# examples 迁移到 AgentSession 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `examples/agent-math.ts` 和 `examples/debug-agent-chat.ts` 从直接使用 `Agent` 迁移到 `AgentSession`，消除重复状态管理。

**Architecture:** `AgentSession` 先扩展 `tools` 选项以支持自定义工具；两个 example 文件分别替换为订阅 `AgentSessionEvent`，`debug-agent-chat.ts` 直接复用 `src/cli/format.ts` 的格式化函数，彻底删除 `TurnFormatter`。

**Tech Stack:** TypeScript, Bun

---

### Task 1: 让 AgentSession 支持传入自定义 tools

**Files:**
- Modify: `src/agent/session.ts:20-33`
- Test: `src/agent/__tests__/session.test.ts`

当前 `AgentSession` 在构造函数中硬编码了 4 个标准工具。为了让 `agent-math.ts` 能传入自定义 math tools，需要给 `AgentSessionOptions` 增加 `tools` 可选字段，并在构造函数中使用传入的工具或默认工具。

- [ ] **Step 1: 添加 `tools` 选项到 `AgentSessionOptions`**

```typescript
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
  /** 自定义工具列表（不传则使用默认的 read/write/edit/bash） */
  tools?: AgentTool<any, any>[];
}
```

- [ ] **Step 2: 修改构造函数使用传入的 tools 或默认 tools**

在 `src/agent/session.ts` 的 `constructor` 中，将：
```typescript
    const tools = [
      createReadTool(options.cwd),
      createWriteTool(options.cwd),
      createEditTool(options.cwd),
      createBashTool(options.cwd),
    ];
```
替换为：
```typescript
    const tools = options.tools ?? [
      createReadTool(options.cwd),
      createWriteTool(options.cwd),
      createEditTool(options.cwd),
      createBashTool(options.cwd),
    ];
```

- [ ] **Step 3: 运行类型检查和 session 测试**

Run: `bun tsc --noEmit`
Expected: 无类型错误

Run: `bun test src/agent/__tests__/session.test.ts`
Expected: 12 pass, 0 fail

- [ ] **Step 4: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(agent): AgentSession 支持传入自定义 tools

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: 迁移 agent-math.ts 到 AgentSession

**Files:**
- Modify: `examples/agent-math.ts`

将 `agent-math.ts` 从直接 `new Agent()` 改为 `new AgentSession()`，使用 `AgentSessionEvent` 替代繁琐的 `AgentEvent` 处理。

- [ ] **Step 1: 修改导入语句**

```typescript
import { AgentSession, type AgentTool } from "../src/agent/index.js";
import { getModel, asSystemPrompt } from "../src/core/ai/index.js";
```

- [ ] **Step 2: 修改创建实例部分**

将 `const agent = new Agent({...})` 整段替换为：

```typescript
const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey: process.env.MINIMAX_API_KEY,
  systemPrompt: "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
  tools: [addTool, subtractTool],
  thinkingLevel: "off",
});
```

- [ ] **Step 3: 替换订阅逻辑**

将 `agent.subscribe((event) => { ... })` 整段替换为：

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "turn_start":
      console.log("[Turn] Started");
      break;
    case "thinking_delta":
      if (event.isFirst) console.log("[Thinking]");
      process.stdout.write(event.text);
      break;
    case "answer_delta":
      if (event.isFirst) console.log("\n[Answer]");
      process.stdout.write(event.text);
      break;
    case "tool_start":
      console.log(`[Tool] Started: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case "tool_end":
      console.log(`[Tool] Ended: ${event.toolName}, isError: ${event.isError}`);
      break;
    case "turn_end":
      console.log(`\n[Turn] Ended`);
      break;
  }
});
```

- [ ] **Step 4: 修改 main 函数**

将 `main()` 函数体替换为：

```typescript
async function main() {
  console.log("=== Agent Math Example ===\n");

  try {
    await session.prompt("What is 5 + 3? What is 10 - 2?");
    await session.waitForIdle();

    console.log("\n=== Final State ===");
    console.log(`Messages: ${session.messages.length}`);

    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      console.log(`Final response: ${JSON.stringify(lastMessage.content, null, 2)}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}
```

- [ ] **Step 5: 运行示例确保编译通过**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add examples/agent-math.ts
git commit -m "refactor(examples): migrate agent-math.ts to AgentSession

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 迁移 debug-agent-chat.ts 到 AgentSession

**Files:**
- Modify: `examples/debug-agent-chat.ts`

将 `debug-agent-chat.ts` 从 `Agent + TurnFormatter` 改为 `AgentSession`，直接复用 `src/cli/format.ts`，删除所有重复的状态管理。

- [ ] **Step 1: 修改导入语句**

```typescript
import { AgentSession } from "../src/agent/index.js";
import { getModel, getEnvApiKey, asSystemPrompt } from "../src/core/ai/index.js";
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
} from "../src/cli/format.js";
```

- [ ] **Step 2: 删除 TurnFormatter 类**

删除 `TurnFormatter` 类的完整定义（约第 37-112 行）。

- [ ] **Step 3: 创建 AgentSession 并订阅事件**

在文件顶部导入之后插入：

```typescript
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
  systemPrompt: "你是一个乐于助人的助手。",
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
```

- [ ] **Step 4: 修改 main 函数**

将 `main()` 函数体替换为：

```typescript
async function main() {
  const inputs = [
    "写一个 200字的作文， 关于春天",
    "请用 bash 工具执行 `date`，然后告诉我现在几点。",
    "请告诉我当前目录是什么",
  ];

  for (const text of inputs) {
    process.stdout.write(formatUserMessage(text));
    session.steer(text);
  }

  try {
    await session.prompt("");
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  }

  console.log("\n[DEBUG] session idle, messages count:", session.messages.length);
  process.exit(0);
}
```

注意：这里将原来一次性传入 messages 数组的方式改为先 `steer` 注入所有前置消息，再 `prompt("")` 触发模型回复（因为 `AgentSession.prompt` 只接受 `string`，不支持数组）。

- [ ] **Step 5: 清理未使用的导入和变量**

确保删除以下未使用的导入/声明：
- `type {AgentEvent}` 的导入
- 文件中残留的 `const agent = ...` 旧声明
- 已删除的 `TurnFormatter` 相关的 `const formatter = ...`

- [ ] **Step 6: 运行类型检查和全部测试**

Run: `bun tsc --noEmit`
Expected: 无类型错误

Run: `bun test src/`
Expected: 全部通过

- [ ] **Step 7: 提交**

```bash
git add examples/debug-agent-chat.ts
git commit -m "refactor(examples): migrate debug-agent-chat.ts to AgentSession

删除 TurnFormatter，直接复用 src/cli/format.ts 和 AgentSession 事件。
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- `agent-math.ts` 迁移到 AgentSession ✅ Task 2
- `debug-agent-chat.ts` 迁移到 AgentSession 并删除 TurnFormatter ✅ Task 3
- `AgentSession` 支持自定义 tools（因为 agent-math 需要）✅ Task 1

**2. Placeholder scan:**
- 无 TBD/TODO
- 所有代码均为完整代码
- 每个步骤均有验证命令

**3. Type consistency：**
- `AgentSessionOptions.tools` 使用 `AgentTool<any, any>[]`
- `AgentSession` 构造函数中 `options.tools ?? [...]` 逻辑一致
- `session.prompt(string)` 与 `session.steer(string)` API 使用正确
