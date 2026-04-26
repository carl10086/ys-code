# 消息架构重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 attachment 生命周期断裂、session 持久化不完整、Debug Inspector LLM View 不准确的问题，实现消息三层架构（Session Store → Agent State → API Payload）。

**Architecture:** 将 `transformMessages` 拆分为三阶段（generate/save/build），`normalizeMessages` 改为纯函数，扩展 session 持久化层支持 `AttachmentEntry`，Debug Inspector 显示真正的 LLM payload。

**Tech Stack:** Bun, TypeScript, jsonl 持久化

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/session/entry-types.ts` | 修改 | 添加 `AttachmentEntry` 类型 |
| `src/session/session-manager.ts` | 修改 | `messageToEntry` 支持 `role: "attachment"` |
| `src/session/session-loader.ts` | 修改 | `entryToMessage` 支持 `type: "attachment"`，添加 exhaustiveness check |
| `src/agent/attachments/normalize.ts` | 重构 | `normalizeMessages` 改为纯函数 |
| `src/agent/stream-assistant.ts` | 重构 | 拆分 `transformMessages` 为三阶段 |
| `src/agent/session.ts` | 修改 | `handleAgentEvent` 处理 attachment，`sentSkillNames` getter 初始化 |
| `src/web/debug/debug-api.ts` | 修改 | 调用 `normalizeMessages` 获取真实 LLM payload |

## 测试文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/session/session-manager.test.ts` | 修改 | 添加 attachment 序列化测试 |
| `src/session/session-loader.test.ts` | 修改 | 添加 attachment 反序列化测试 |
| `src/agent/attachments/normalize.test.ts` | 创建 | `normalizeMessages` 纯函数行为测试 |
| `src/agent/stream-assistant.test.ts` | 修改 | 添加三阶段拆分测试 |
| `src/agent/session.test.ts` | 修改 | 添加 attachment message_end 事件处理测试 |
| `src/web/debug/debug-api.test.ts` | 创建 | Debug API payload 准确性测试 |

---

## 前置检查

- [ ] **Step 0.1: 确认当前分支不是 main**

```bash
git branch --show-current
```

Expected: 功能分支名（如 `feature/message-architecture-redesign`）。如果是 `main`，立即创建功能分支：

```bash
git checkout -b feature/message-architecture-redesign
```

- [ ] **Step 0.2: 确认现有测试通过**

```bash
bun test
```

Expected: 所有现有测试通过（记录失败数，作为基准）。

---

## Task 1: 扩展 Entry 类型支持 Attachment

**Files:**
- Modify: `src/session/entry-types.ts`
- Test: `src/session/session-manager.test.ts`（在本 Task 中只写测试结构，等 Task 2 实现后运行）

- [ ] **Step 1.1: 修改 `entry-types.ts` 添加 `AttachmentEntry`**

在 `src/session/entry-types.ts` 中，`CompactBoundaryEntry` 之后添加：

```typescript
/** Attachment 条目 */
export interface AttachmentEntry extends SessionEntry {
  /** 条目类型 */
  type: "attachment";
  /** 附件类型 */
  attachmentType: "relevant_memories" | "file" | "directory" | "skill_listing";
  /** 附件内容（序列化后的 JSON） */
  content: string;
}
```

在文件底部的 `Entry` 联合类型中添加 `AttachmentEntry`：

```typescript
/** 所有条目的联合类型 */
export type Entry =
  | HeaderEntry
  | UserEntry
  | AssistantEntry
  | ToolResultEntry
  | CompactBoundaryEntry
  | AttachmentEntry;
```

- [ ] **Step 1.2: 运行类型检查确认无编译错误**

```bash
bunx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 1.3: Commit**

```bash
git add src/session/entry-types.ts
git commit -m "feat(session): add AttachmentEntry type"
```

---

## Task 2: 扩展 SessionManager 支持 Attachment

**Files:**
- Modify: `src/session/session-manager.ts`
- Modify: `src/session/session-manager.test.ts`

- [ ] **Step 2.1: 修改 `SessionManager.messageToEntry` 支持 attachment**

在 `src/session/session-manager.ts` 中，找到 `messageToEntry` 的 `switch` 语句。在 `case "toolResult"` 之后、`default` 之前添加：

```typescript
    case "attachment":
      return {
        type: "attachment",
        uuid,
        parentUuid,
        timestamp,
        attachmentType: (message as any).attachment.type,
        content: JSON.stringify((message as any).attachment),
      } as AttachmentEntry;
```

同时修改文件顶部的导入，添加 `AttachmentEntry`：

```typescript
import type { Entry, UserEntry, AssistantEntry, ToolResultEntry, AttachmentEntry } from "./entry-types.js";
```

- [ ] **Step 2.2: 在 `session-manager.test.ts` 中添加 attachment 序列化测试**

在 `src/session/session-manager.test.ts` 中添加以下测试（放在文件末尾或合适的位置）：

```typescript
import type { AgentMessage } from "../agent/types.js";
import type { AttachmentEntry } from "./entry-types.js";

describe("SessionManager attachment support", () => {
  it("should convert attachment message to AttachmentEntry", () => {
    const manager = new SessionManager({ baseDir: tmpdir(), cwd: process.cwd() });
    const message: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Available skills: read, write",
        skillNames: ["read", "write"],
        timestamp: 1234567890,
      },
      timestamp: 1234567890,
    } as AgentMessage;

    manager.appendMessage(message);

    const entries = (manager as any).storage.readAllEntries(manager.filePath);
    const attachmentEntry = entries.find((e: any): e is AttachmentEntry => e.type === "attachment");

    expect(attachmentEntry).toBeDefined();
    expect(attachmentEntry?.attachmentType).toBe("skill_listing");
    expect(attachmentEntry?.content).toBe(JSON.stringify(message.attachment));
  });

  it("should convert file attachment to AttachmentEntry", () => {
    const manager = new SessionManager({ baseDir: tmpdir(), cwd: process.cwd() });
    const message: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "file",
        filePath: "/test/file.ts",
        content: { type: "text", text: "export const x = 1;" },
        timestamp: 1234567890,
      },
      timestamp: 1234567890,
    } as AgentMessage;

    manager.appendMessage(message);

    const entries = (manager as any).storage.readAllEntries(manager.filePath);
    const attachmentEntry = entries.find((e: any): e is AttachmentEntry => e.type === "attachment");

    expect(attachmentEntry).toBeDefined();
    expect(attachmentEntry?.attachmentType).toBe("file");
    const parsed = JSON.parse(attachmentEntry!.content);
    expect(parsed.filePath).toBe("/test/file.ts");
  });
});
```

注意：测试中使用 `(manager as any).storage` 访问私有字段，因为测试需要读取存储内容验证。

- [ ] **Step 2.3: 运行 SessionManager 测试**

```bash
bun test src/session/session-manager.test.ts
```

Expected: 所有测试通过，包括新添加的 attachment 测试。

- [ ] **Step 2.4: Commit**

```bash
git add src/session/session-manager.ts src/session/session-manager.test.ts
git commit -m "feat(session): support attachment in SessionManager"
```

---

## Task 3: 扩展 SessionLoader 支持 Attachment

**Files:**
- Modify: `src/session/session-loader.ts`
- Modify: `src/session/session-loader.test.ts`

- [ ] **Step 3.1: 修改 `SessionLoader.entryToMessage` 支持 attachment**

在 `src/session/session-loader.ts` 中，找到 `entryToMessage` 的 `switch` 语句。在 `case "toolResult"` 之后添加 `case "attachment"` 和 `default`：

```typescript
    case "attachment":
      return {
        role: "attachment",
        attachment: JSON.parse(entry.content),
        timestamp: entry.timestamp,
      } as unknown as AgentMessage;

    default:
      // 向后兼容：忽略不认识的 Entry 类型（REQ-10）
      return undefined as unknown as AgentMessage;
```

注意：修改后 `switch` 语句必须有 `default` case 以处理所有 Entry 类型，确保 exhaustiveness。

同时修改 `restoreMessages` 方法，在 `messages.push` 后过滤掉 `undefined`：

```typescript
  restoreMessages(entries: Entry[]): AgentMessage[] {
    if (entries.length === 0) return [];

    const activeBranch = this.findActiveBranch(entries);

    const messages: AgentMessage[] = [];
    for (const entry of activeBranch) {
      if (entry.type === "header") continue;

      if (entry.type === "compact_boundary") {
        messages.push({
          role: "system",
          content: [{ type: "text", text: entry.summary }],
          timestamp: entry.timestamp,
        } as unknown as AgentMessage);
        continue;
      }

      const message = this.entryToMessage(entry);
      if (message !== undefined) {
        messages.push(message);
      }
    }

    return messages;
  }
```

- [ ] **Step 3.2: 在 `session-loader.test.ts` 中添加 attachment 反序列化测试**

在 `src/session/session-loader.test.ts` 中添加以下测试：

```typescript
import type { Entry } from "./entry-types.js";

describe("SessionLoader attachment support", () => {
  it("should restore attachment entry to AgentMessage", () => {
    const loader = new SessionLoader();
    const entries: Entry[] = [
      {
        type: "attachment",
        uuid: "uuid-1",
        parentUuid: null,
        timestamp: 1234567890,
        attachmentType: "skill_listing",
        content: '{"type":"skill_listing","content":"skills","skillNames":["read"],"timestamp":1234567890}',
      },
    ];

    const messages = loader.restoreMessages(entries);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("attachment");
    expect((messages[0] as any).attachment.type).toBe("skill_listing");
    expect((messages[0] as any).attachment.skillNames).toEqual(["read"]);
  });

  it("should round-trip serialize and restore attachment", () => {
    const baseDir = tmpdir();
    const manager = new SessionManager({ baseDir, cwd: process.cwd() });
    const originalMessage: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "directory",
        path: "/test/dir",
        content: ["file1.ts", "file2.ts"],
        timestamp: 1234567890,
      },
      timestamp: 1234567890,
    } as AgentMessage;

    manager.appendMessage(originalMessage);

    const restoredMessages = manager.restoreMessages();
    expect(restoredMessages).toHaveLength(1);
    expect(restoredMessages[0].role).toBe("attachment");
    expect((restoredMessages[0] as any).attachment.type).toBe("directory");
    expect((restoredMessages[0] as any).attachment.path).toBe("/test/dir");
    expect((restoredMessages[0] as any).attachment.content).toEqual(["file1.ts", "file2.ts"]);
  });
});
```

- [ ] **Step 3.3: 运行 SessionLoader 测试**

```bash
bun test src/session/session-loader.test.ts
```

Expected: 所有测试通过。

- [ ] **Step 3.4: Commit**

```bash
git add src/session/session-loader.ts src/session/session-loader.test.ts
git commit -m "feat(session): support attachment in SessionLoader"
```

---

## Task 4: 重构 normalizeMessages 为纯函数

**Files:**
- Modify: `src/agent/attachments/normalize.ts`
- Create: `src/agent/attachments/normalize.test.ts`

- [ ] **Step 4.1: 修改 `normalizeMessages` 为纯函数**

在 `src/agent/attachments/normalize.ts` 中，将 `normalizeMessages` 函数替换为以下实现：

```typescript
/**
 * 将 AgentMessage[] 中的 attachment 展开并合并到相邻 user message
 * 纯函数：不修改输入数组中的任何对象
 */
export function normalizeMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role !== "attachment") {
      // 非 attachment 直接推入，但创建浅拷贝避免修改原对象
      result.push({ ...msg });
      continue;
    }

    const expanded = normalizeAttachment(msg.attachment);
    if (expanded.length === 0) continue;

    // 尝试合并到前一个 user message
    const last = result[result.length - 1];
    if (
      last &&
      last.role === "user" &&
      typeof last.content === "string"
    ) {
      const first = expanded[0];
      if (typeof first.content === "string") {
        // 创建新的 user message 而不是修改原数组中的对象
        result[result.length - 1] = {
          ...last,
          content: last.content + "\n" + first.content,
        };
        result.push(...expanded.slice(1));
        continue;
      }
    }

    // 无法合并，直接追加
    result.push(...expanded);
  }

  return result;
}
```

注意：关键改动是
1. 非 attachment 消息也创建 `{ ...msg }` 浅拷贝
2. 合并时使用 `result[result.length - 1] = { ...last, content: ... }` 创建新对象，而不是 `last.content = ...`
3. 输入数组 `messages` 本身及其元素均不被修改

- [ ] **Step 4.2: 创建 `normalize.test.ts` 测试纯函数行为**

创建 `src/agent/attachments/normalize.test.ts`：

```typescript
import { describe, it, expect } from "bun:test";
import { normalizeMessages } from "./normalize.js";
import type { AgentMessage } from "../types.js";

describe("normalizeMessages purity", () => {
  it("should not modify input array or its elements", () => {
    const userMsg: AgentMessage = {
      role: "user",
      content: "Hello",
      timestamp: 1000,
    } as AgentMessage;

    const attachmentMsg: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Available skills: read",
        skillNames: ["read"],
        timestamp: 2000,
      },
      timestamp: 2000,
    } as AgentMessage;

    const input = [userMsg, attachmentMsg];
    const originalContent = userMsg.content;

    const result = normalizeMessages(input);

    // 输入数组本身不变
    expect(input).toHaveLength(2);
    expect(input[0].content).toBe(originalContent); // 元素不被修改
    expect(input[1].role).toBe("attachment"); // attachment 元素不变

    // 输出是新数组
    expect(result).not.toBe(input);
    // 输出中 attachment 已展开为 user
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("Hello");
  });

  it("should merge attachment into previous user message when possible", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "First message", timestamp: 1000 },
      {
        role: "attachment",
        attachment: { type: "relevant_memories", entries: [{ key: "k", value: "v" }], timestamp: 2000 },
        timestamp: 2000,
      },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("First message");
    expect(result[0].content).toContain("system-reminder");
  });

  it("should not merge when previous message is not user", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: 1000 },
      {
        role: "attachment",
        attachment: { type: "skill_listing", content: "Skills", skillNames: [], timestamp: 2000 },
        timestamp: 2000,
      },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("assistant");
    expect(result[1].role).toBe("user");
    expect(result[1].content).toContain("system-reminder");
  });

  it("should handle multiple attachments in sequence", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 },
      {
        role: "attachment",
        attachment: { type: "file", filePath: "/a.ts", content: { type: "text", text: "export const a" }, timestamp: 2000 },
        timestamp: 2000,
      },
      {
        role: "attachment",
        attachment: { type: "file", filePath: "/b.ts", content: { type: "text", text: "export const b" }, timestamp: 3000 },
        timestamp: 3000,
      },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    // 两个 attachment 都应合并到同一个 user message
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("Hello");
    expect(result[0].content).toContain("/a.ts");
    expect(result[0].content).toContain("/b.ts");
  });

  it("should handle empty messages array", () => {
    const result = normalizeMessages([]);
    expect(result).toHaveLength(0);
  });

  it("should handle messages without attachments", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 },
      { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: 2000 },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });
});
```

- [ ] **Step 4.3: 运行 normalize 测试**

```bash
bun test src/agent/attachments/normalize.test.ts
```

Expected: 所有测试通过。

- [ ] **Step 4.4: Commit**

```bash
git add src/agent/attachments/normalize.ts src/agent/attachments/normalize.test.ts
git commit -m "refactor(attachments): make normalizeMessages pure function"
```

---

## Task 5: 重构 streamAssistantResponse 为三阶段

**Files:**
- Modify: `src/agent/stream-assistant.ts`
- Modify: `src/agent/stream-assistant.test.ts`

- [ ] **Step 5.1: 添加新导入**

在 `src/agent/stream-assistant.ts` 顶部，在现有导入基础上添加：

```typescript
import { join } from "node:path";
import { getCommands } from "../commands/index.js";
import { formatSkillListing } from "./attachments/skill-listing.js";
import type { PromptCommand } from "../commands/types.js";
```

- [ ] **Step 5.2: 添加三阶段函数**

在 `src/agent/stream-assistant.ts` 中，`transformMessages` 函数之前添加以下三个函数：

```typescript
/**
 * 阶段 1: 生成 Attachment Messages
 * 生成但不保存，返回需要被添加的 attachment 列表
 */
async function generateAttachments(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): Promise<AgentMessage[]> {
  const attachments: AgentMessage[] = [];

  // userContext attachments
  if (!config.disableUserContext && !config.transformContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    const userContextAttachments = getUserContextAttachments(userContext);
    attachments.push(...userContextAttachments);
  }

  // skill listing attachments
  const sentSkillNames = context.sentSkillNames ?? new Set<string>();
  const skillCommands = await getCommands(join(process.cwd(), ".claude/skills"));
  const newSkills = skillCommands.filter(
    (cmd): cmd is PromptCommand => cmd.type === "prompt" && !sentSkillNames.has(cmd.name)
  );
  if (newSkills.length > 0) {
    const content = formatSkillListing(newSkills);
    attachments.push({
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content,
        skillNames: newSkills.map(s => s.name),
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    } as AgentMessage);
  }

  // @mention attachments
  for (const msg of context.messages) {
    if (msg.role !== "user" || typeof msg.content !== "string") continue;
    const mentionedFiles = extractAtMentionedFiles(msg.content);
    for (const fp of mentionedFiles) {
      const attachment = await readAtMentionedFile(fp, process.cwd());
      if (attachment) {
        attachments.push({ role: "attachment", attachment, timestamp: Date.now() } as AgentMessage);
      }
    }
  }

  return attachments;
}

/**
 * 阶段 2: 保存 Attachments 到 Agent State
 * 通过事件机制将 attachment 持久化
 */
async function saveAttachments(
  attachments: AgentMessage[],
  emit: AgentEventSink,
): Promise<void> {
  for (const attachment of attachments) {
    await emit({ type: "message_start", message: attachment });
    await emit({ type: "message_end", message: attachment });
  }
}

/**
 * 阶段 3: 构建 API Payload
 * 纯函数，输入完整 messages（含 attachment），输出 LLM 可用格式
 */
function buildApiPayload(
  messages: AgentMessage[],
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>,
): Promise<Message[]> {
  // normalize 将 attachment → user message（<system-reminder> 包装）
  const normalized = normalizeMessages(messages);
  // convertToLlm 过滤 role（默认只保留 user/assistant/toolResult）
  return Promise.resolve(convertToLlm(normalized as AgentMessage[]));
}
```

注意：`buildApiPayload` 中 `convertToLlm(normalized as AgentMessage[])` 使用类型断言，因为 `normalizeMessages` 返回 `Message[]`，但 `convertToLlm` 参数类型为 `AgentMessage[]`。这是已知的设计约束，类型断言是安全的因为 `Message` 是 `AgentMessage` 的子集。

- [ ] **Step 5.3: 替换 `transformMessages` 并修改 `streamAssistantResponse`**

将现有的 `transformMessages` 函数（约 31-52 行）整个替换为：

```typescript
/**
 * 将 AgentMessage[] 转换为最终发送给 LLM 的 Message[]
 * 已废弃：三阶段函数（generateAttachments / saveAttachments / buildApiPayload）替代
 * 保留此函数以兼容现有调用点
 */
async function transformMessages(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): Promise<Message[]> {
  const attachments = await generateAttachments(context, config, signal);
  const allMessages = [...context.messages, ...attachments];
  return buildApiPayload(allMessages, config.convertToLlm);
}
```

然后修改 `streamAssistantResponse` 函数体。找到：

```typescript
export async function streamAssistantResponse(...) {
  const llmMessages = await transformMessages(context, config, signal);
```

替换为：

```typescript
export async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  // === 阶段 1: 生成 Attachments ===
  const attachments = await generateAttachments(context, config, signal);

  // === 阶段 2: 保存 Attachments 到 State ===
  // 这会触发 message_end 事件，将 attachment 写入 agent.state.messages
  await saveAttachments(attachments, emit);

  // === 阶段 3: 构建 API Payload ===
  // 显式构建包含 attachment 的完整消息列表，不依赖 context.messages 是否已被修改
  const allMessages = [...context.messages, ...attachments];
  const llmMessages = await buildApiPayload(allMessages, config.convertToLlm);
```

- [ ] **Step 5.4: 导出三阶段函数（供测试使用）**

在 `stream-assistant.ts` 文件底部（`streamAssistantResponse` 之后），添加导出：

```typescript
// 导出三阶段函数供测试使用
export { generateAttachments, saveAttachments, buildApiPayload };
```

- [ ] **Step 5.5: 在 `stream-assistant.test.ts` 中添加三阶段测试**

在 `src/agent/stream-assistant.test.ts` 中添加以下测试（放在文件末尾或合适位置）：

```typescript
import { generateAttachments, saveAttachments, buildApiPayload } from "./stream-assistant.js";
import type { AgentContext } from "./types.js";
import type { AgentLoopConfig } from "./types.js";
import { FileStateCache } from "./file-state.js";

function createMockFileStateCache() {
  return new FileStateCache();
}

describe("generateAttachments", () => {
  it("should not generate userContext attachments when disabled", async () => {
    const context: AgentContext = { messages: [] };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m as any,
      disableUserContext: true,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    const hasUserContext = attachments.some(
      (a) => a.role === "attachment" && (a as any).attachment.type === "relevant_memories"
    );
    expect(hasUserContext).toBe(false);
  });

  it("should not duplicate skill listing for already sent skills", async () => {
    const context: AgentContext = {
      messages: [],
      sentSkillNames: new Set(["read"]),
    };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m as any,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    const skillAttachment = attachments.find(
      (a) => a.role === "attachment" && (a as any).attachment.type === "skill_listing"
    );
    if (skillAttachment) {
      expect((skillAttachment as any).attachment.skillNames).not.toContain("read");
    }
  });
});

describe("saveAttachments", () => {
  it("should emit message_start and message_end for each attachment", async () => {
    const attachments: AgentMessage[] = [
      {
        role: "attachment",
        attachment: { type: "skill_listing", content: "Skills", skillNames: [], timestamp: 1000 },
        timestamp: 1000,
      } as AgentMessage,
    ];

    const events: any[] = [];
    const mockEmit = async (event: any) => {
      events.push(event);
    };

    await saveAttachments(attachments, mockEmit);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("message_start");
    expect(events[0].message.role).toBe("attachment");
    expect(events[1].type).toBe("message_end");
    expect(events[1].message.role).toBe("attachment");
  });

  it("should handle empty attachments array", async () => {
    const events: any[] = [];
    const mockEmit = async (event: any) => {
      events.push(event);
    };

    await saveAttachments([], mockEmit);

    expect(events).toHaveLength(0);
  });
});

describe("buildApiPayload", () => {
  it("should call normalizeMessages then convertToLlm", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 } as AgentMessage,
      {
        role: "attachment",
        attachment: { type: "skill_listing", content: "Skills", skillNames: [], timestamp: 2000 },
        timestamp: 2000,
      } as AgentMessage,
    ];

    const convertToLlm = (msgs: AgentMessage[]) =>
      msgs.filter((m) => m.role === "user" || m.role === "assistant");

    const result = await buildApiPayload(messages, convertToLlm);

    // attachment 已被 normalize 为 user message，然后被 convertToLlm 保留
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((m) => m.role !== "attachment")).toBe(true);
  });
});
```

- [ ] **Step 5.6: 运行 stream-assistant 测试**

```bash
bun test src/agent/stream-assistant.test.ts
```

Expected: 所有测试通过。注意现有 `injectAtMentionAttachments` 的测试仍然应该通过（该函数未被删除）。

- [ ] **Step 5.7: Commit**

```bash
git add src/agent/stream-assistant.ts src/agent/stream-assistant.test.ts
git commit -m "refactor(stream-assistant): split transformMessages into three phases"
```

---

## Task 6: 更新 AgentSession 处理 Attachment 事件

**Files:**
- Modify: `src/agent/session.ts`
- Modify: `src/agent/session.test.ts`

- [ ] **Step 6.1: 修改 `sentSkillNames` getter**

在 `src/agent/session.ts` 中，找到 `sentSkillNames` getter：

```typescript
get sentSkillNames(): Set<string> {
  return this.agent.state.sentSkillNames ?? new Set();
}
```

替换为：

```typescript
get sentSkillNames(): Set<string> {
  if (!this.agent.state.sentSkillNames) {
    this.agent.state.sentSkillNames = new Set();
  }
  return this.agent.state.sentSkillNames;
}
```

- [ ] **Step 6.2: 修改 `handleAgentEvent` 处理 attachment**

在 `src/agent/session.ts` 中，找到 `case "message_end":`（约 276-279 行），替换为：

```typescript
    case "message_end": {
      // 保存到 SessionManager（所有 role 的消息，包括 attachment）
      this.sessionManager.appendMessage(event.message);
      this.sessionManager.compactIfNeeded();

      // 如果是 skill_listing attachment，标记 skills 已发送
      const msg = event.message;
      if (msg.role === "attachment") {
        const attachment = (msg as any).attachment;
        if (
          attachment?.type === "skill_listing" &&
          Array.isArray(attachment.skillNames)
        ) {
          for (const name of attachment.skillNames) {
            this.sentSkillNames.add(name);
          }
        }
      }

      break;
    }
```

- [ ] **Step 6.3: 在 `session.test.ts` 中添加 attachment 事件处理测试**

在 `src/agent/session.test.ts` 中添加以下测试：

```typescript
describe("AgentSession attachment handling", () => {
  it("should append attachment message to sessionManager on message_end", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const appendSpy = spyOn(session["sessionManager" as any], "appendMessage");

    const attachmentMessage: AgentMessage = {
      role: "attachment",
      attachment: { type: "file", filePath: "/test.ts", content: { type: "text", text: "" }, timestamp: 1000 },
      timestamp: 1000,
    } as AgentMessage;

    // 通过 agent 触发事件
    session["handleAgentEvent"]({ type: "message_end", message: attachmentMessage });

    expect(appendSpy).toHaveBeenCalledWith(attachmentMessage);
  });

  it("should mark skills as sent for skill_listing attachment", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const skillMessage: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Skills",
        skillNames: ["read", "write"],
        timestamp: 1000,
      },
      timestamp: 1000,
    } as AgentMessage;

    session["handleAgentEvent"]({ type: "message_end", message: skillMessage });

    expect(session.sentSkillNames.has("read")).toBe(true);
    expect(session.sentSkillNames.has("write")).toBe(true);
  });

  it("should not affect sentSkillNames for non-skill attachment", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" } as any,
      apiKey: "test",
    });

    const initialSize = session.sentSkillNames.size;

    const fileMessage: AgentMessage = {
      role: "attachment",
      attachment: { type: "file", filePath: "/test.ts", content: { type: "text", text: "" }, timestamp: 1000 },
      timestamp: 1000,
    } as AgentMessage;

    session["handleAgentEvent"]({ type: "message_end", message: fileMessage });

    expect(session.sentSkillNames.size).toBe(initialSize);
  });
});
```

- [ ] **Step 6.4: 运行 session 测试**

```bash
bun test src/agent/session.test.ts
```

Expected: 所有测试通过。

- [ ] **Step 6.5: Commit**

```bash
git add src/agent/session.ts src/agent/session.test.ts
git commit -m "feat(agent): handle attachment events in AgentSession"
```

---

## Task 7: 更新 Debug Inspector

**Files:**
- Modify: `src/web/debug/debug-api.ts`
- Create: `src/web/debug/debug-api.test.ts`

- [ ] **Step 7.1: 修改 `debug-api.ts` 导入 `normalizeMessages`**

在 `src/web/debug/debug-api.ts` 顶部添加导入：

```typescript
import { normalizeMessages } from "../../agent/attachments/normalize.js";
```

- [ ] **Step 7.2: 修改 `buildDebugContext` 调用 `normalizeMessages`**

在 `src/web/debug/debug-api.ts` 中，找到 `buildDebugContext` 函数体。将：

```typescript
  const messages = [...session.messages];
  const llmMessages = await session.convertToLlm(messages);
```

替换为：

```typescript
  const messages = [...session.messages];  // 包含 attachment
  const llmMessages = await session.convertToLlm(normalizeMessages(messages));  // 正确的 LLM payload
```

- [ ] **Step 7.3: 创建 `debug-api.test.ts`**

创建 `src/web/debug/debug-api.test.ts`：

```typescript
import { describe, it, expect } from "bun:test";
import { buildDebugContext, type DebugContextResponse } from "./debug-api.js";
import { setDebugAgentSession } from "./debug-context.js";
import type { AgentMessage } from "../../agent/types.js";

describe("Debug API buildDebugContext", () => {
  it("should include normalized messages in llmMessages", async () => {
    const mockSession = {
      messages: [
        { role: "user", content: "Hello", timestamp: 1000 } as AgentMessage,
        {
          role: "attachment",
          attachment: { type: "skill_listing", content: "Skills", skillNames: [], timestamp: 2000 },
          timestamp: 2000,
        } as AgentMessage,
      ],
      convertToLlm: (msgs: AgentMessage[]) => msgs.filter((m) => m.role !== "attachment"),
      sessionId: "test-session",
      model: { name: "test-model", provider: "test-provider" },
      isStreaming: false,
      pendingToolCalls: new Set(),
      tools: [],
      getSystemPrompt: () => "You are a helpful assistant.",
    };

    setDebugAgentSession(mockSession as any);

    const context = await buildDebugContext();

    expect(context).not.toBeNull();
    expect(context!.messages).toHaveLength(2); // 原始消息含 attachment
    expect(context!.llmMessages).toHaveLength(1); // LLM payload 不含 attachment
    expect(context!.llmMessages[0].role).toBe("user");
    // 验证 normalizeMessages 被调用（通过检查 content 是否包含 system-reminder）
    expect(context!.llmMessages[0].content).toContain("<system-reminder>");
  });

  it("should return null when no active session", async () => {
    setDebugAgentSession(undefined);

    const context = await buildDebugContext();

    expect(context).toBeNull();
  });

  it("should handle empty messages", async () => {
    const mockSession = {
      messages: [],
      convertToLlm: (msgs: AgentMessage[]) => msgs,
      sessionId: "empty-session",
      model: { name: "test", provider: "test" },
      isStreaming: false,
      pendingToolCalls: new Set(),
      tools: [],
      getSystemPrompt: () => "",
    };

    setDebugAgentSession(mockSession as any);

    const context = await buildDebugContext();

    expect(context!.messages).toHaveLength(0);
    expect(context!.llmMessages).toHaveLength(0);
  });
});
```

- [ ] **Step 7.4: 运行 debug-api 测试**

```bash
bun test src/web/debug/debug-api.test.ts
```

Expected: 所有测试通过。

- [ ] **Step 7.5: Commit**

```bash
git add src/web/debug/debug-api.ts src/web/debug/debug-api.test.ts
git commit -m "fix(debug): show real LLM payload with normalizeMessages in Debug Inspector"
```

---

## Task 8: 全量回归测试

**Files:**
- 所有已修改文件

- [ ] **Step 8.1: 运行全部测试**

```bash
bun test
```

Expected: 所有测试通过。

- [ ] **Step 8.2: 运行类型检查**

```bash
bunx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 8.3: 检查测试覆盖率**

```bash
bun test --coverage
```

Expected: 新增代码有充分覆盖。

- [ ] **Step 8.4: Commit**

```bash
git commit --allow-empty -m "test: all tests pass after message architecture redesign"
```

---

## 验收标准检查清单

实现完成后，逐一验证：

- [ ] `src/session/entry-types.ts` 包含 `AttachmentEntry` 类型定义
- [ ] `src/session/session-manager.ts` 的 `messageToEntry` 支持 `role: "attachment"`
- [ ] `src/session/session-loader.ts` 的 `entryToMessage` 支持 `type: "attachment"`
- [ ] `normalizeMessages` 不修改输入数组（已通过单元测试验证）
- [ ] `streamAssistantResponse` 使用三阶段流程（generate → save → build）
- [ ] `AgentSession.handleAgentEvent` 在 `message_end` 时处理 attachment 并更新 `sentSkillNames`
- [ ] `AgentSession.sentSkillNames` getter 在 `undefined` 时正确初始化
- [ ] `debug-api.ts` 的 `buildDebugContext` 调用 `normalizeMessages`
- [ ] Debug Inspector LLM View 显示的内容包含 `<system-reminder>` 包装
- [ ] Session 文件包含 `type: "attachment"` 的 Entry
- [ ] Skill listing attachment 恢复后不再重复发送
- [ ] 现有测试全部通过
- [ ] 新增 attachment Entry 的序列化/反序列化测试通过
- [ ] 新增三阶段拆分的单元测试通过
- [ ] 新增 Debug Inspector LLM payload 准确性验证测试通过
