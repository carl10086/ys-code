# 移除 relevant_memories 持久化，改为动态 prepend CLAUDE.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐 CC 设计：CLAUDE.md 内容不持久化到 session，改为每次 API 调用前动态 prepend；移除 relevant_memories attachment 类型。

**Architecture:** 保留 memoized `getUserContext()` 读取 CLAUDE.md；新增 `prependUserContext()` 在 `buildApiPayload` 阶段动态注入；彻底移除 `relevant_memories` attachment 的生成、持久化和 normalize 逻辑。

**Tech Stack:** TypeScript, Bun

---

## 设计背景：CC 原本的设计

CC（claude-code-haha）中 CLAUDE.md 的处理遵循三个核心原则：

1. **一次性读取（memoized）** —— `getUserContext()` 使用 `memoize` 包装，进程生命周期内只读取一次 `.claude/CLAUDE.md` 和 `.claude/rules/*.md`，结果缓存在内存中。
2. **动态注入（prepend）** —— `prependUserContext()` 在**每次 API 调用前**将 CLAUDE.md 内容包装成 `<system-reminder>` 格式的 `user` message，并标记 `isMeta: true`，然后 prepend 到 messages 最前面。
3. **绝不持久化** —— CLAUDE.md 内容**不进入** `session.messages`，不通过 `message_end` 事件保存，不写入磁盘。因为文件内容可能随时更新，持久化会导致旧版本一直存在。

另外，CC 中的 `relevant_memories` 机制对应的是 `~/.claude/auto-memory/` 目录下的动态记忆文件（用户说"auto-memory 就是个测试功能，永远不需要"），与 CLAUDE.md 完全无关。我们不需要实现 relevant_memories。

---

## 当前代码问题

| 文件 | 问题 |
|------|------|
| `src/agent/context/user-context.ts` | `getUserContextAttachments()` 把 userContext 包装成 `relevant_memories` attachment |
| `src/agent/stream-assistant.ts` | `generateAttachments()` 生成 relevant_memories → `saveAttachments()` 通过 `message_end` 事件持久化到 session |
| `src/agent/attachments/normalize.ts` | `relevant_memories` 分支生成 user message 但**缺少 `isMeta: true`**，且合并逻辑可能把它合并到普通 user message |
| `src/session/session-manager.ts` | `messageToEntry()` 将 `role === "attachment"` 的消息持久化为 `AttachmentEntry` |

---

## 文件变更清单

- **Modify:** `src/agent/context/user-context.ts` —— 删除 `getUserContextAttachments()`，重写 `prependUserContext()`
- **Modify:** `src/agent/stream-assistant.ts` —— 移除 relevant_memories 生成，改为调用 `prependUserContext()`
- **Modify:** `src/agent/attachments/normalize.ts` —— 移除 `relevant_memories` case
- **Modify:** `src/session/session-manager.ts` —— 忽略 attachment 消息，不再持久化
- **Modify:** `src/agent/attachments/types.ts` —— 从 Attachment union 类型中移除 `RelevantMemoriesAttachment`
- **Test:** `src/agent/session.test.ts`, `src/agent/stream-assistant.test.ts` —— 调整测试

---

## Task 1: 清理 user-context.ts

**Files:**
- Modify: `src/agent/context/user-context.ts`

**Context:**
当前 `getUserContextAttachments()` 将 userContext 转为 `relevant_memories` attachment，`prependUserContext()` 调用它并走 normalize 流程。需要改为直接构造 `isMeta: true` 的 user message。

- [ ] **Step 1: 删除 `getUserContextAttachments()` 函数**

删除整段函数（第 64-83 行）。同时删除 `AttachmentMessage` 的 import（第 3 行），因为此文件不再使用它。

- [ ] **Step 2: 重写 `prependUserContext()` 函数**

替换为直接构造 user message，不再依赖 `normalizeMessages`：

```typescript
/** 将 userContext 动态注入 messages 最前面 */
export function prependUserContext(messages: Message[], context: UserContext): Message[] {
  const entries = Object.entries(context)
    .filter(([, value]) => value && value.trim() !== "")
    .map(([key, value]) => ({ key, value: value! }));

  if (entries.length === 0) return messages;

  const content = [
    "<system-reminder>",
    "As you answer the user's questions, you can use the following context:",
    ...entries.map((e) => `# ${e.key}\n${e.value}`),
    "",
    "IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
    "</system-reminder>",
    "",
  ].join("\n");

  const metaMessage: UserMessage = {
    role: "user",
    content,
    timestamp: Date.now(),
    isMeta: true,
  };

  return [metaMessage, ...messages];
}
```

注意：删除 `@deprecated` 注释，因为这个函数现在是主要使用方式。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

## Task 2: 修改 stream-assistant.ts 数据流

**Files:**
- Modify: `src/agent/stream-assistant.ts`

**Context:**
当前在 `generateAttachments()` 中生成 userContext attachment，然后 `saveAttachments()` 持久化。改为在 `buildApiPayload()` 中调用 `prependUserContext()` 动态注入。

- [ ] **Step 1: 修改 import**

将 `getUserContextAttachments` 替换为 `prependUserContext`：

```typescript
import { getUserContext, prependUserContext } from "./context/user-context.js";
```

- [ ] **Step 2: 从 `generateAttachments()` 中移除 userContext 逻辑**

删除 `generateAttachments()` 中以下代码块（第 39-44 行）：

```typescript
  // userContext attachments
  if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    const userContextAttachments = getUserContextAttachments(userContext);
    attachments.push(...userContextAttachments);
  }
```

`generateAttachments()` 现在只处理 skill_listing 和 @mention。

- [ ] **Step 3: 在 `buildApiPayload()` 前注入 userContext**

修改 `streamAssistantResponse()` 函数中的阶段 3 逻辑（第 197-200 行）：

原代码：
```typescript
  // === 阶段 3: 构建 API Payload ===
  // 显式构建包含 attachment 的完整消息列表，不依赖 context.messages 是否已被修改
  const allMessages = [...context.messages, ...attachments];
  const llmMessages = await buildApiPayload(allMessages, config.convertToLlm);
```

改为：
```typescript
  // === 阶段 3: 构建 API Payload ===
  // 动态注入 userContext（不持久化）
  let allMessages = [...context.messages, ...attachments];
  if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    allMessages = prependUserContext(allMessages, userContext);
  }
  const llmMessages = await buildApiPayload(allMessages, config.convertToLlm);
```

注意：`prependUserContext()` 返回新数组，不修改原数组。

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

## Task 3: 清理 normalize.ts

**Files:**
- Modify: `src/agent/attachments/normalize.ts`

**Context:**
`relevant_memories` attachment 类型不再需要，应从 `normalizeAttachment()` 中移除。

- [ ] **Step 1: 移除 `relevant_memories` case**

删除 `normalizeAttachment()` 中的 `case "relevant_memories":` 分支（第 8-19 行）。

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

## Task 4: 停止持久化 attachment 消息

**Files:**
- Modify: `src/session/session-manager.ts`

**Context:**
当前 `messageToEntry()` 将 `role === "attachment"` 的消息持久化到磁盘。由于 skill_listing 和 @mention 都是动态生成且不需要跨轮次保留，应停止持久化所有 attachment 消息。

- [ ] **Step 1: 在 `appendMessage()` 中忽略 attachment**

修改 `appendMessage()` 方法（第 55-58 行）：

```typescript
  /** 追加消息并持久化 */
  appendMessage(message: AgentMessage): void {
    // attachment 消息动态生成，不需要持久化
    if (message.role === "attachment") return;
    
    const entry = this.messageToEntry(message);
    this.storage.appendEntry(this._filePath, entry);
    this._lastUuid = entry.uuid;
  }
```

- [ ] **Step 2: 从 `messageToEntry()` 中移除 attachment case**

删除 `case "attachment":` 分支（第 139-148 行）。由于 `appendMessage()` 已经过滤，理论上不会走到这里，但为了类型安全，在 `default` 前加一个 `case "attachment": throw new Error("attachment should not be persisted");` 或者直接保留 default 的 throw。

更简洁的做法是：保留 `case "attachment":` 但让它 `throw new Error("attachment messages should not be persisted")`。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

## Task 5: 清理 attachment 类型定义

**Files:**
- Modify: `src/agent/attachments/types.ts`

**Context:**
从 Attachment union 类型中移除 `RelevantMemoriesAttachment`。

- [ ] **Step 1: 读取当前 types.ts 确认结构**

Run: `cat src/agent/attachments/types.ts`

- [ ] **Step 2: 删除 `RelevantMemoriesAttachment` 类型定义**

删除类似于以下的类型定义：

```typescript
export interface RelevantMemoriesAttachment {
  type: "relevant_memories";
  entries: { key: string; value: string }[];
  timestamp: number;
}
```

并从 `export type Attachment = ...` 的 union 中移除 `| RelevantMemoriesAttachment`。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `bun run tsc --noEmit`
Expected: 0 errors

---

## Task 6: 更新测试

**Files:**
- Modify: `src/agent/__tests__/stream-assistant.test.ts`
- Modify: `src/agent/__tests__/session.test.ts`

**Context:**
测试可能引用了 `getUserContextAttachments` 或断言了 attachment 的持久化行为，需要同步调整。

- [ ] **Step 1: 运行现有测试，查看失败**

Run: `bun test src/agent/__tests__/stream-assistant.test.ts src/agent/__tests__/session.test.ts`
Expected: 可能有失败，记录失败位置

- [ ] **Step 2: 修复 stream-assistant 测试**

如果测试引用了 `getUserContextAttachments`，改为测试 `prependUserContext`。如果测试断言了 `relevant_memories` attachment 的生成，改为断言 `prependUserContext` 后 messages 最前面是 `isMeta: true` 的 user message。

- [ ] **Step 3: 修复 session 测试**

如果测试断言了 attachment 的持久化，改为断言 attachment 被忽略（session 中不包含）。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/__tests__/stream-assistant.test.ts src/agent/__tests__/session.test.ts`
Expected: all pass

---

## Task 7: 端到端验证

**Files:**
- 不需要修改文件

- [ ] **Step 1: 启动应用并发送消息**

Run: `bun run src/main.ts --web`

发送几条消息，观察 Debug Inspector（`http://127.0.0.1:<port>/debug`）。

- [ ] **Step 2: 验证 attachment 不累积**

Expected:
- `session.messages` 中**不包含** `role: "attachment"` 且 `attachment.type === "relevant_memories"` 的消息
- `llmMessages` 中第一条消息是 `role: "user"` 且 `isMeta: true`，包含 `<system-reminder>` 包装的 CLAUDE.md 内容
- 每轮对话后 session 文件不新增 attachment entry

- [ ] **Step 3: 验证 CLAUDE.md 更新生效**

修改 `.claude/CLAUDE.md` 或 `.claude/rules/*.md` 的内容，发送新消息。

Expected: LLM 收到的 system-reminder 内容反映最新文件内容（因为 `getUserContext()` 是 memoized，但进程重启后会重新读取；如果在同一进程中需要热更新，这是另一个问题，不在本次范围内）。

---

## Self-Review

**1. Spec coverage:**
- ✅ 移除 `relevant_memories` attachment 生成（Task 1, 2）
- ✅ 改为动态 `prependUserContext()`（Task 1, 2）
- ✅ 停止持久化 attachment（Task 4）
- ✅ 清理 `normalize.ts` 中的 `relevant_memories` case（Task 3）
- ✅ 清理类型定义（Task 5）
- ✅ 测试更新（Task 6）
- ✅ 端到端验证（Task 7）

**2. Placeholder scan:**
- ✅ 无 "TBD"、"TODO"、"implement later"
- ✅ 每步都有具体代码或命令
- ✅ 文件路径精确

**3. Type consistency:**
- `prependUserContext()` 返回 `Message[]`
- `getUserContext()` 保持 `Promise<UserContext>`
- `Attachment` union 类型移除 `RelevantMemoriesAttachment`
- 所有变更内部一致

---

## 数据流对比

### 修改前
```
getUserContext()
  → getUserContextAttachments()       【生成 relevant_memories attachment】
  → generateAttachments()
  → saveAttachments()
  → emit message_end
  → SessionManager.appendMessage()    【持久化到磁盘】
  → buildApiPayload()
  → normalizeMessages()               【attachment → user message】
  → API
```

### 修改后
```
getUserContext()                      【memoized，内存缓存】

streamAssistantResponse():
  → generateAttachments()             【只生成 skill_listing + @mention】
  → saveAttachments()                 【只保存 skill_listing + @mention】
  → prependUserContext(allMessages)   【动态注入 CLAUDE.md，isMeta: true】
  → buildApiPayload()
  → normalizeMessages()
  → API
```

CLAUDE.md 内容**只在内存中**，每次 API 调用前动态注入，**不进入 session 文件**。
