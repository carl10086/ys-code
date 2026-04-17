# AgentSession 作为 CodingAgent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AgentSession` 明确为 `CodingAgent` 产品层抽象，内置 cc 风格 coding-agent system prompt 作为默认行为。

**Architecture:** 新建 `coding-agent.ts` 用 `createSystemPromptBuilder` 组装所有 section；`AgentSession` 构造函数中未传 `systemPrompt` 时自动使用内置 builder；TUI 和 debug-agent-chat 简化构造参数；agent-math 回归底层 `Agent` 演示自定义能力；废弃 CLI 入口。

**Tech Stack:** TypeScript, Bun

---

## 文件结构

| 文件 | 职责 | 变更 |
|------|------|------|
| `src/agent/system-prompt/coding-agent.ts` | 组装所有 section 为 coding-agent builder | 新增 |
| `src/agent/session.ts` | `AgentSession` 核心类 | 修改：systemPrompt 变可选，内置默认 builder |
| `src/tui/app.tsx` | TUI 入口 | 删除 systemPrompt 参数和 argv 逻辑 |
| `src/tui/hooks/useAgent.ts` | TUI hook | 删除 systemPrompt 字段 |
| `examples/debug-agent-chat.ts` | 调试示例 | 删除 systemPrompt 参数 |
| `examples/agent-math.ts` | 底层 Agent 示例 | 改回使用 `Agent` |
| `src/cli/chat.ts` | 废弃 CLI 入口 | 删除 |
| `src/cli/__tests__/chat-pipe.test.ts` | 废弃测试 | 删除 |

---

### Task 1: 新增 coding-agent builder

**Files:**
- Create: `src/agent/system-prompt/coding-agent.ts`

- [ ] **Step 1: 创建 coding-agent.ts**

```typescript
// src/agent/system-prompt/coding-agent.ts
import type { SystemPrompt } from "../../core/ai/index.js";
import { asSystemPrompt } from "../../core/ai/index.js";
import { createSystemPromptBuilder } from "./systemPrompt.js";
import type { SystemPromptContext, SystemPromptSection } from "./types.js";
import * as intro from "./sections/intro.js";
import * as system from "./sections/system.js";
import * as doingTasks from "./sections/doing-tasks.js";
import * as actions from "./sections/actions.js";
import * as usingYourTools from "./sections/using-your-tools.js";
import * as envInfo from "./sections/env-info.js";
import * as outputEfficiency from "./sections/output-efficiency.js";
import * as toneAndStyle from "./sections/tone-and-style.js";
import * as summarizeToolResults from "./sections/summarize-tool-results.js";
import * as sessionSpecificGuidance from "./sections/session-specific-guidance.js";

function staticSection(name: string, compute: (context: SystemPromptContext) => Promise<string>): SystemPromptSection {
  return { name, compute, getCacheKey: () => name };
}

function dynamicSection(name: string, compute: (context: SystemPromptContext) => Promise<string>): SystemPromptSection {
  return { name, compute };
}

const sections: SystemPromptSection[] = [
  staticSection("intro", intro.compute),
  staticSection("system", system.compute),
  staticSection("doing-tasks", doingTasks.compute),
  staticSection("actions", actions.compute),
  dynamicSection("using-your-tools", usingYourTools.compute),
  dynamicSection("env-info", envInfo.compute),
  staticSection("output-efficiency", outputEfficiency.compute),
  staticSection("tone-and-style", toneAndStyle.compute),
  staticSection("summarize-tool-results", summarizeToolResults.compute),
  staticSection("session-specific-guidance", sessionSpecificGuidance.compute),
];

export function buildCodingAgentSystemPrompt(
  context: SystemPromptContext,
): Promise<SystemPrompt> {
  return createSystemPromptBuilder(sections)(context);
}
```

- [ ] **Step 2: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/system-prompt/coding-agent.ts
git commit -m "feat(agent): add coding-agent system prompt builder

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: AgentSession 内置默认 system prompt

**Files:**
- Modify: `src/agent/session.ts`

- [ ] **Step 1: 添加导入**

在 `session.ts` 顶部添加：

```typescript
import { buildCodingAgentSystemPrompt } from "./system-prompt/coding-agent.js";
```

- [ ] **Step 2: 修改 AgentSessionOptions**

将 `systemPrompt` 字段改为可选：

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
  /** 自定义 system prompt（不传则使用内置 coding-agent prompt） */
  systemPrompt?: (context: SystemPromptContext) => Promise<SystemPrompt>;
  /** 自定义工具列表（不传则使用默认的 read/write/edit/bash） */
  tools?: AgentTool<any, any>[];
}
```

- [ ] **Step 3: 修改构造函数默认值**

将构造函数中的赋值改为：

```typescript
    this.systemPromptBuilder = options.systemPrompt ?? buildCodingAgentSystemPrompt;
```

- [ ] **Step 4: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(agent): AgentSession 内置 coding-agent system prompt

systemPrompt 变为可选字段，未传时自动使用 cc 风格 coding prompt。
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 简化 TUI

**Files:**
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/hooks/useAgent.ts`

- [ ] **Step 1: 修改 useAgent.ts**

删除 `UseAgentOptions` 中的 `systemPrompt` 字段：

```typescript
export interface UseAgentOptions {
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
}
```

删除 `useMemo` 中的 `systemPrompt` 传递：

```typescript
    return new AgentSession({
      cwd: process.cwd(),
      model: options.model,
      apiKey: options.apiKey,
    });
```

删除 `asSystemPrompt` 的导入（如不再使用）。

- [ ] **Step 2: 修改 app.tsx**

删除 `const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";`

修改 `useAgent` 调用：

```typescript
  const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage } = useAgent({
    model,
    apiKey,
  });
```

- [ ] **Step 3: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/tui/app.tsx src/tui/hooks/useAgent.ts
git commit -m "refactor(tui): simplify by removing systemPrompt parameter

AgentSession now has built-in default.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 4: 简化 debug-agent-chat.ts

**Files:**
- Modify: `examples/debug-agent-chat.ts`

- [ ] **Step 1: 删除 systemPrompt 参数**

将构造改为：

```typescript
const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
});
```

删除 `asSystemPrompt` 的导入。

- [ ] **Step 2: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add examples/debug-agent-chat.ts
git commit -m "refactor(examples): simplify debug-agent-chat.ts

Remove explicit systemPrompt, use AgentSession built-in default.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 5: agent-math.ts 回归底层 Agent

**Files:**
- Modify: `examples/agent-math.ts`

- [ ] **Step 1: 改为使用 Agent**

完整替换文件内容：

```typescript
/**
 * Agent Math Example
 *
 * 演示直接使用 Agent API（自定义 tools、systemPrompt）
 */

import { Type } from "@sinclair/typebox";
import { Agent, type AgentTool } from "../src/agent/index.js";
import { getModel, asSystemPrompt } from "../src/core/ai/index.js";

const addTool: AgentTool = {
  name: "add",
  description: "Add two numbers together",
  parameters: Type.Object({
    a: Type.Number({ description: "First number" }),
    b: Type.Number({ description: "Second number" }),
  }),
  label: "Add",
  async execute(toolCallId, params) {
    const result = params.a + params.b;
    return {
      content: [{ type: "text", text: `${params.a} + ${params.b} = ${result}` }],
      details: { result },
    };
  },
};

const subtractTool: AgentTool = {
  name: "subtract",
  description: "Subtract two numbers",
  parameters: Type.Object({
    a: Type.Number({ description: "First number" }),
    b: Type.Number({ description: "Second number" }),
  }),
  label: "Subtract",
  async execute(toolCallId, params) {
    const result = params.a - params.b;
    return {
      content: [{ type: "text", text: `${params.a} - ${params.b} = ${result}` }],
      details: { result },
    };
  },
};

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const agent = new Agent({
  systemPrompt: async () =>
    asSystemPrompt([
      "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
    ]),
  initialState: {
    model,
    thinkingLevel: "off",
    tools: [addTool, subtractTool],
  },
  getApiKey: () => process.env.MINIMAX_API_KEY,
});

agent.subscribe((event, signal) => {
  switch (event.type) {
    case "turn_start":
      console.log("[Turn] Started");
      break;
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_delta") {
        process.stdout.write(ae.delta);
      } else if (ae.type === "text_delta") {
        process.stdout.write(ae.delta);
      }
      break;
    }
    case "tool_execution_start":
      console.log(`[Tool] Started: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case "tool_execution_end":
      console.log(`[Tool] Ended: ${event.toolName}, isError: ${event.isError}`);
      break;
    case "turn_end":
      console.log("\n[Turn] Ended");
      break;
  }
});

async function main() {
  console.log("=== Agent Math Example ===\n");

  try {
    await agent.prompt("What is 5 + 3? What is 10 - 2?");
    await agent.waitForIdle();

    console.log("\n=== Final State ===");
    console.log(`Messages: ${agent.state.messages.length}`);

    const lastMessage = agent.state.messages[agent.state.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      console.log(`Final response: ${JSON.stringify(lastMessage.content, null, 2)}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

- [ ] **Step 2: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add examples/agent-math.ts
git commit -m "refactor(examples): agent-math.ts reverts to raw Agent API

Demonstrates custom tools and systemPrompt at the low level.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 6: 删除废弃 CLI 入口

**Files:**
- Delete: `src/cli/chat.ts`
- Delete: `src/cli/__tests__/chat-pipe.test.ts`

- [ ] **Step 1: 删除文件**

```bash
git rm src/cli/chat.ts src/cli/__tests__/chat-pipe.test.ts
```

- [ ] **Step 2: 运行测试**

Run: `bun test src/`
Expected: 全部通过（注意 pipe 测试已被删除）

- [ ] **Step 3: 提交**

```bash
git commit -m "refactor(cli): remove deprecated chat.ts entry point

TUI is now the sole interactive interface.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 全量类型检查**

Run: `bun tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `bun test src/`
Expected: 全部通过

- [ ] **Step 3: 确认无遗漏**

```bash
grep -r "new AgentSession({" src/ examples/ | grep -v "systemPrompt" || echo "All AgentSession calls use default systemPrompt"
```

Expected: 无异常匹配

---

## Self-Review

**1. Spec coverage:**
- `coding-agent.ts` builder 实现 ✅ Task 1
- `AgentSession` 默认 system prompt ✅ Task 2
- TUI 简化 ✅ Task 3
- `debug-agent-chat.ts` 简化 ✅ Task 4
- `agent-math.ts` 回归 `Agent` ✅ Task 5
- 删除废弃 CLI ✅ Task 6
- 端到端验证 ✅ Task 7

**2. Placeholder scan:**
- 无 TBD/TODO
- 所有代码为完整代码
- 每个步骤有验证命令

**3. Type consistency：**
- `AgentSessionOptions.systemPrompt` 类型为可选 `(context: SystemPromptContext) => Promise<SystemPrompt>`
- `buildCodingAgentSystemPrompt` 签名一致
- TUI `UseAgentOptions` 移除 `systemPrompt` 字段
