# Debug Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/debug` 命令，将当前会话上下文导出为 `debug-context.json` 文件

**Architecture:** 在 `src/commands/debug/` 下创建独立的命令模块，通过 `CommandContext.session` 获取数据，使用 Node.js `fs` 写入 JSON 文件

**Tech Stack:** TypeScript, Node.js fs/path 模块

---

## File Structure

```
src/commands/debug/
  └── index.ts      # 命令入口
  └── debug.ts      # 命令实现

src/agent/session.ts   # 修改：添加 sessionId getter
src/commands/index.ts   # 修改：注册 debug 命令
```

---

## Task 1: 添加 AgentSession sessionId getter

**Files:**
- Modify: `src/agent/session.ts`

- [ ] **Step 1: 添加 sessionId getter**

在 `AgentSession` 类中，在第 44 行 `private sessionId = crypto.randomUUID();` 之后添加 public getter：

```typescript
/** 会话 ID（只读） */
get sessionId(): string {
  return this.sessionId;
}
```

注意：由于 TypeScript 的类字段遮蔽规则，需要将 `private sessionId` 重命名为 `private _sessionId`，然后添加 getter：

```typescript
private _sessionId = crypto.randomUUID();

get sessionId(): string {
  return this._sessionId;
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(agent): expose sessionId via getter"
```

---

## Task 2: 创建 Debug 命令模块

**Files:**
- Create: `src/commands/debug/index.ts`
- Create: `src/commands/debug/debug.ts`

- [ ] **Step 1: 创建 debug.ts 实现文件**

```typescript
// src/commands/debug/debug.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async (_args, context) => {
  const { session } = context;

  const debugData = {
    sessionId: session.sessionId,
    model: session.model.name,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
    systemPrompt: session.getSystemPrompt(),
    messages: session.messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      timestamp: msg.timestamp,
    })),
  };

  const filePath = join(process.cwd(), "debug-context.json");

  try {
    writeFileSync(filePath, JSON.stringify(debugData, null, 2), "utf-8");
    return { type: "text", value: `已导出上下文到 ${filePath}` };
  } catch (error) {
    return { type: "text", value: `导出失败: ${error}` };
  }
};
```

- [ ] **Step 2: 创建 index.ts 入口文件**

```typescript
// src/commands/debug/index.ts
import type { Command } from "../../commands/types.js";

const debug = {
  type: "local",
  name: "debug",
  description: "导出当前会话上下文为 JSON 文件",
  load: () => import("./debug.js"),
} satisfies Command;

export default debug;
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/commands/debug/
git commit -m "feat(commands): add /debug command to export session context"
```

---

## Task 3: 注册 Debug 命令

**Files:**
- Modify: `src/commands/index.ts`

- [ ] **Step 1: 导入 debug 命令**

在 `src/commands/index.ts` 第 9-14 行的导入区域添加：

```typescript
import debug from "./debug/index.js";
```

- [ ] **Step 2: 注册到 BUILTIN_COMMANDS**

在 `BUILTIN_COMMANDS` 数组中添加 `debug`：

```typescript
export const BUILTIN_COMMANDS: Command[] = [
  exit,
  clear,
  debug,  // 新增
  tools,
  help,
  system,
  skills,
];
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/commands/index.ts
git commit -m "feat(commands): register /debug command"
```

---

## 验证步骤

1. 启动 TUI 应用
2. 输入 `/debug` 命令
3. 检查当前目录是否生成了 `debug-context.json` 文件
4. 验证文件内容包含 sessionId、model、systemPrompt、messages 等字段
