# Tool NewMessages 自动注入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工具返回的 `newMessages` 能自动触发下一轮循环，使 LLM 能在同一 turn 内看到这些消息

**Architecture:** 利用 `context.pendingMessages` 作为通信通道，工具返回 newMessages 后加入 context.pendingMessages，runLoop 检测到后触发新一轮循环

**Tech Stack:** TypeScript, bun:test

---

## Task 1: 添加 AgentContext.pendingMessages 类型

**Files:**
- Modify: `src/agent/types.ts:144-150`

- [ ] **Step 1: 修改 AgentContext 类型**

```typescript
/** Agent 上下文快照 */
export interface AgentContext {
  messages: AgentMessage[];
  tools?: AgentTool<any, any>[];
  /** 已发送的 skill 名称集合（用于去重） */
  sentSkillNames?: Set<string>;
  /** 工具返回的新消息，供循环使用（UI 隐藏，LLM 可见） */
  pendingMessages?: AgentMessage[];
}
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/types.ts
git commit -m "feat(types): add pendingMessages to AgentContext

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 修改 executeToolCallsSequential 处理 newMessages

**Files:**
- Modify: `src/agent/tool-execution.ts:220-232`

- [ ] **Step 1: 修改 Sequential 模式中 newMessages 处理逻辑**

将:
```typescript
// 注入 newMessages 到 messages 列表
if (executed.newMessages && executed.newMessages.length > 0) {
  for (const msg of executed.newMessages) {
    currentContext.messages.push(msg);
  }
  logger.debug("Injected newMessages from tool", { count: executed.newMessages.length });
}
```

改为:
```typescript
// 将 newMessages 加入 pendingMessages，触发下一轮循环
if (executed.newMessages && executed.newMessages.length > 0) {
  currentContext.pendingMessages = currentContext.pendingMessages || [];
  currentContext.pendingMessages.push(...executed.newMessages);
  logger.debug("Tool newMessages queued for next turn", { count: executed.newMessages.length });
}
```

同时删除 `contextModifier` 中对 `messages` 的直接修改（因为我们不再手动加入 messages）。

- [ ] **Step 2: 运行测试验证**

Run: `bun test src/agent/tool-execution.test.ts 2>&1 | head -30`
Expected: 测试通过（或无相关测试）

- [ ] **Step 3: 提交**

```bash
git add src/agent/tool-execution.ts
git commit -m "feat(tool-execution): newMessages 加入 context.pendingMessages

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: 修改 executeToolCallsParallel 处理 newMessages

**Files:**
- Modify: `src/agent/tool-execution.ts:279-290`

- [ ] **Step 1: 修改 Parallel 模式中 newMessages 处理逻辑**

将:
```typescript
// 注入 newMessages 到 messages 列表
if (executed.newMessages && executed.newMessages.length > 0) {
  for (const msg of executed.newMessages) {
    currentContext.messages.push(msg);
  }
  logger.debug("Injected newMessages from tool (parallel)", { count: executed.newMessages.length });
}
```

改为:
```typescript
// 将 newMessages 加入 pendingMessages，触发下一轮循环
if (executed.newMessages && executed.newMessages.length > 0) {
  currentContext.pendingMessages = currentContext.pendingMessages || [];
  currentContext.pendingMessages.push(...executed.newMessages);
  logger.debug("Tool newMessages queued for next turn (parallel)", { count: executed.newMessages.length });
}
```

- [ ] **Step 2: 提交**

```bash
git add src/agent/tool-execution.ts
git commit -m "feat(tool-execution): parallel 模式同样使用 pendingMessages

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 修改 runLoop 检查 pendingMessages

**Files:**
- Modify: `src/agent/agent-loop.ts:121-131`

- [ ] **Step 1: 在 inner while 循环后添加 pendingMessages 检查**

在 line 121 的 `}` 之后、line 123 的 `const followUpMessages` 之前添加:

```typescript
    // 检查 context.pendingMessages（工具返回的 newMessages）
    const contextPending = currentContext.pendingMessages || [];
    if (contextPending.length > 0) {
      currentContext.pendingMessages = [];
      pendingMessages = contextPending;
      hasPreEmittedTurnStart = false;
      continue;
    }
```

- [ ] **Step 2: 运行测试验证**

Run: `bun test src/agent/agent-loop.test.ts 2>&1 | head -50`
Expected: 测试通过

- [ ] **Step 3: 提交**

```bash
git add src/agent/agent-loop.ts
git commit -m "feat(agent-loop): 检查 context.pendingMessages 触发循环

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: 创建集成测试验证

**Files:**
- Create: `examples/debug-skill-newmessages.ts`

- [ ] **Step 1: 创建测试文件**

参考 `examples/debug-agent-chat.ts`，创建测试文件：

```typescript
import { AgentSession } from "../src/agent/index.js";
import { getModel, getEnvApiKey } from "../src/core/ai/index.js";
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

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
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

async function main() {
  // 使用 brainstorming skill（会返回 newMessages）
  const inputs = [
    "/brainstorming",
    "结合我们的代码分析 agent loop",
  ];

  for (const text of inputs) {
    process.stdout.write(formatUserMessage(text));
    session.steer(text);
  }

  try {
    // 传入两条消息的 prompt
    await session.prompt([
      { role: "user", content: [{ type: "text", text: "/brainstorming" }], timestamp: Date.now() },
      { role: "user", content: [{ type: "text", text: "结合我们的代码分析 agent loop" }], timestamp: Date.now() },
    ]);
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  }

  console.log("\n[DEBUG] session idle, messages count:", session.messages.length);
  console.log("[DEBUG] Check if LLM responded to the skill content");
  process.exit(0);
}

main();
```

- [ ] **Step 2: 运行测试**

Run: `bun run examples/debug-skill-newmessages.ts 2>&1`
Expected:
- SkillTool 被调用（看到 tool_start/tool_end 输出）
- LLM 继续响应（不是 "OK Skill" 后无响应）
- 最终有 assistant 消息回复

- [ ] **Step 3: 提交**

```bash
git add examples/debug-skill-newmessages.ts
git commit -m "feat(example): add debug-skill-newmessages test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 验证标准

1. `bun test` 全部通过
2. 运行 `bun run examples/debug-skill-newmessages.ts` 能看到 LLM 对 skill 内容作出响应
3. 不再出现 "OK Skill" 后无响应的情况
