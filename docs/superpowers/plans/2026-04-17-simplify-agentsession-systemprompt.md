# AgentSession systemPrompt 简化计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AgentSessionOptions` 中的 `systemPrompt` 统一为单一函数形式，删除 `string` 和 `SystemPromptSection[]` 的 sugar 分支，把 build 逻辑上移到 CLI/TUI/examples。

**Architecture:** 参考 cc 的 `getSystemPrompt(tools, model)` 模式——调用方负责构建 system prompt，`AgentSession` 只负责在每轮运行时调用传入的函数并刷新给底层 `Agent`。这样 `AgentSession` 职责更薄，与底层 `Agent` 的 `systemPrompt: (context) => Promise<SystemPrompt>` API 对齐。

**Tech Stack:** TypeScript, Bun

---

## 文件结构

| 文件 | 职责 | 变更 |
|------|------|------|
| `src/agent/session.ts` | `AgentSession` 核心类 | 精简 `AgentSessionOptions`；删除 `systemPromptBuilder` 分支；直接透传函数给底层 `Agent` |
| `src/agent/__tests__/session.test.ts` | `AgentSession` 测试 | 删除二选一校验测试；所有构造调用改为传入函数 |
| `src/cli/chat.ts` | CLI 入口 | 用 `asSystemPrompt([...])` 包装字符串传入 |
| `src/tui/hooks/useAgent.ts` | TUI hook | 同上 |
| `examples/agent-math.ts` | 示例 | 同上 |
| `examples/debug-agent-chat.ts` | 示例 | 同上 |

---

### Task 1: 精简 AgentSession 类型与构造函数

**Files:**
- Modify: `src/agent/session.ts:1-77`
- Test: `src/agent/__tests__/session.test.ts`

- [ ] **Step 1: 修改 `AgentSessionOptions` 接口**

将接口中 `systemPrompt` 和 `systemPromptSections` 字段删除，替换为单一函数字段：

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
  /** system prompt 构建函数，每轮运行前调用 */
  systemPrompt: (context: SystemPromptContext) => Promise<SystemPrompt>;
  /** 自定义工具列表（不传则使用默认的 read/write/edit/bash） */
  tools?: AgentTool<any, any>[];
}
```

- [ ] **Step 2: 删除 `createSystemPromptBuilder` 导入**

删除 `session.ts` 顶部对 `createSystemPromptBuilder` 的导入（保留 `SystemPromptContext` 导入）：

```typescript
// 删除这一行
import { createSystemPromptBuilder } from "./system-prompt/systemPrompt.js";
```

- [ ] **Step 3: 修改构造函数，删除分支逻辑**

将构造函数中从第 66 行开始的 `if (options.systemPromptSections && options.systemPrompt)` 校验和 `systemPromptBuilder` 赋值全部替换为：

```typescript
    this.systemPromptBuilder = options.systemPrompt;
```

同时删除之前声明的 `private readonly systemPromptBuilder: (context: SystemPromptContext) => Promise<SystemPrompt>;` 周围的 `Promise<SystemPrompt>` 类型无需改动（如果已经存在）。

- [ ] **Step 4: 修改 `refreshSystemPrompt` 直接透传**

`refreshSystemPrompt` 当前已直接调用 `this.systemPromptBuilder(context)`，通常无需改动。确认其赋值给 `this.agent.systemPrompt` 的代码如下即可：

```typescript
  private async refreshSystemPrompt(): Promise<void> {
    const context: SystemPromptContext = {
      cwd: this.cwd,
      tools: this.agent.state.tools,
      model: this.agent.state.model,
    };
    const prompt = await this.systemPromptBuilder(context);
    this.agent.systemPrompt = async () => prompt;
  }
```

- [ ] **Step 5: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 可能有 `session.test.ts` 等调用方报错，属于预期

- [ ] **Step 6: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(agent): AgentSession systemPrompt 统一为函数形式

删除 string/sections 分支，与底层 Agent API 对齐。
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: 更新 session 测试

**Files:**
- Modify: `src/agent/__tests__/session.test.ts`

- [ ] **Step 1: 添加 `asSystemPrompt` 导入**

在测试文件顶部添加：

```typescript
import { asSystemPrompt } from "../../core/ai/index.js";
```

- [ ] **Step 2: 删除二选一校验测试**

删除整个 `it("should reject both systemPrompt and systemPromptSections", ...)` 测试用例（第 16-27 行）。

- [ ] **Step 3: 为所有 `new AgentSession` 添加 `systemPrompt` 函数**

将文件中所有 `new AgentSession({ cwd: "/tmp", model, apiKey: "test" })` 替换为：

```typescript
new AgentSession({ cwd: "/tmp", model, apiKey: "test", systemPrompt: async () => asSystemPrompt([""]) })
```

文件中共有 12 处 `new AgentSession` 调用，全部需要修改。

- [ ] **Step 4: 运行 session 测试**

Run: `bun test src/agent/__tests__/session.test.ts`
Expected: 12 pass, 0 fail

- [ ] **Step 5: 提交**

```bash
git add src/agent/__tests__/session.test.ts
git commit -m "test(agent): update session tests for function-only systemPrompt

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 更新 CLI 入口

**Files:**
- Modify: `src/cli/chat.ts:1-27`

- [ ] **Step 1: 添加 `asSystemPrompt` 导入**

将导入改为：

```typescript
import { getModel, getEnvApiKey, asSystemPrompt } from "../core/ai/index.js";
```

- [ ] **Step 2: 将字符串包装为函数传入**

将 `session` 创建处从：

```typescript
const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
  systemPrompt: systemPromptText,
});
```

改为：

```typescript
const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
  systemPrompt: async () => asSystemPrompt([systemPromptText]),
});
```

- [ ] **Step 3: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/cli/chat.ts
git commit -m "refactor(cli): adapt chat.ts to function-only AgentSession systemPrompt

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 4: 更新 TUI hook

**Files:**
- Modify: `src/tui/hooks/useAgent.ts:1-37`

- [ ] **Step 1: 添加 `asSystemPrompt` 导入**

将导入改为：

```typescript
import type { Model, asSystemPrompt } from "../../core/ai/index.js";
```

注意：因为 `useAgent.ts` 使用的是 `import type { ... }`，需要把 `asSystemPrompt` 改成值导入：

```typescript
import type { Model } from "../../core/ai/index.js";
import { asSystemPrompt } from "../../core/ai/index.js";
```

或者合并为：

```typescript
import { asSystemPrompt, type Model } from "../../core/ai/index.js";
```

- [ ] **Step 2: 将字符串包装为函数传入**

将 `useMemo` 中 `new AgentSession({...})` 的 `systemPrompt` 字段从：

```typescript
      systemPrompt: options.systemPrompt,
```

改为：

```typescript
      systemPrompt: async () => asSystemPrompt([options.systemPrompt]),
```

- [ ] **Step 3: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/tui/hooks/useAgent.ts
git commit -m "refactor(tui): adapt useAgent hook to function-only AgentSession systemPrompt

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 5: 更新 examples

**Files:**
- Modify: `examples/agent-math.ts`
- Modify: `examples/debug-agent-chat.ts`

- [ ] **Step 1: 修改 `examples/agent-math.ts`**

添加导入：

```typescript
import { getModel, asSystemPrompt } from "../src/core/ai/index.js";
```

将 `systemPrompt` 字段从：

```typescript
  systemPrompt:
    "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
```

改为：

```typescript
  systemPrompt: async () =>
    asSystemPrompt([
      "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
    ]),
```

- [ ] **Step 2: 修改 `examples/debug-agent-chat.ts`**

添加导入：

```typescript
import { getModel, getEnvApiKey, asSystemPrompt } from "../src/core/ai/index.js";
```

将 `systemPrompt` 字段从：

```typescript
  systemPrompt: "你是一个乐于助人的助手。",
```

改为：

```typescript
  systemPrompt: async () => asSystemPrompt(["你是一个乐于助人的助手。"]),
```

- [ ] **Step 3: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add examples/agent-math.ts examples/debug-agent-chat.ts
git commit -m "refactor(examples): adapt examples to function-only AgentSession systemPrompt

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 6: 端到端验证

**Files:** 全部相关

- [ ] **Step 1: 全量类型检查**

Run: `bun tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `bun test src/`
Expected: 全部通过（session 测试应 pass）

- [ ] **Step 3: 确认无遗漏**

Grep 检查是否还有直接使用 `systemPromptSections` 或 `AgentSessionOptions` 的旧调用：

```bash
grep -r "systemPromptSections" src/ examples/
grep -r "new AgentSession({" src/ examples/ | grep -v "systemPrompt:"
```

Expected: 无匹配（或只有已修改的文件）

---

## Self-Review

**1. Spec coverage:**
- `AgentSessionOptions` 精简为函数-only systemPrompt ✅ Task 1
- 删除 string/sections 分支及二选一校验 ✅ Task 1
- 测试更新 ✅ Task 2
- CLI 适配 ✅ Task 3
- TUI 适配 ✅ Task 4
- Examples 适配 ✅ Task 5
- 端到端验证 ✅ Task 6

**2. Placeholder scan:**
- 无 TBD/TODO
- 所有代码为完整代码块
- 每个步骤有验证命令

**3. Type consistency：**
- `AgentSessionOptions.systemPrompt` 类型为 `(context: SystemPromptContext) => Promise<SystemPrompt>`
- 所有调用方统一使用 `async () => asSystemPrompt([...])`
- 底层 `Agent.systemPrompt` 接收 `() => Promise<SystemPrompt>`，赋值逻辑一致
