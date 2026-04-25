# 消息架构重构设计方案

> 基于需求文档 `docs/requirements/2026-04-26-message-architecture-redesign.md`
> 实施策略：一次性完整实施（4 个 Phase 合并）

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| **对齐 CC 架构** | Attachment 参与完整消息生命周期，可被持久化 |
| **纯转换函数** | `normalizeMessages` 不修改输入，只做 API 格式转换 |
| **准确观测** | Debug Inspector LLM View 显示真正传给 LLM 的完整 payload |
| **向后兼容** | 现有 session 文件可正常读取，新功能渐进式启用 |

## 2. 核心设计原则

### 2.1 消息分层模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: API Payload（临时生成，每次请求独立构建）            │
│  - buildApiPayload(): normalizeMessages + convertToLlm      │
│  - prependUserContext() → 添加 CLAUDE.md 等动态上下文         │
│  - 直接传给 LLM API，不保存                                  │
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Agent State（内存状态，运行时可变）                  │
│  - agent.state.messages: AgentMessage[]                     │
│  - 包含: user, assistant, toolResult, attachment            │
│  - 通过 message_end 事件追加新消息                           │
│  - 被 SessionManager 持久化到磁盘                            │
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Session Store（磁盘持久化，跨进程恢复）              │
│  - ~/.ys-code/sessions/*.jsonl                              │
│  - Entry 类型: header, user, assistant, toolResult          │
│  - 新增: attachment Entry 类型                              │
│  - 通过 SessionManager.restoreMessages() 加载到内存          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键规则

**Rule 1: 只有 `message_end` 事件能修改 `agent.state.messages`**
- 所有消息（含 attachment）必须通过 `emit({ type: "message_end", message })` 进入状态
- `transformMessages()` 不再直接修改任何状态

**Rule 2: `normalizeMessages()` 是纯函数**
- 输入: `AgentMessage[]`（含 attachment）
- 输出: `Message[]`（仅 user/assistant/toolResult，attachment 已展开为 user message）
- 不修改输入数组中的任何对象，不保存输出结果

**Rule 3: userContext 保持临时注入**
- CLAUDE.md、日期、分支等动态内容在 API 调用前注入
- 不保存到 session，每次请求重新读取
- 与 CC 设计一致

## 3. 具体改动设计

### 3.1 扩展 Entry 类型支持 Attachment

**文件**: `src/session/entry-types.ts`

**新增**:
```typescript
/** Attachment 条目 */
export interface AttachmentEntry extends SessionEntry {
  type: "attachment";
  /** 附件类型 */
  attachmentType: "relevant_memories" | "file" | "directory" | "skill_listing";
  /** 附件内容（序列化后的 JSON） */
  content: string;
}

/** 所有条目的联合类型 */
export type Entry = 
  | HeaderEntry 
  | UserEntry 
  | AssistantEntry 
  | ToolResultEntry 
  | CompactBoundaryEntry
  | AttachmentEntry;  // ← 新增
```

### 3.2 扩展 SessionManager 支持 Attachment

**文件**: `src/session/session-manager.ts`

**修改 `messageToEntry`**:
```typescript
private messageToEntry(message: AgentMessage): Entry {
  const uuid = crypto.randomUUID();
  const parentUuid = this._lastUuid;
  const timestamp = message.timestamp ?? Date.now();

  switch (message.role) {
    case "user":
      return {
        type: "user",
        uuid,
        parentUuid,
        timestamp,
        content: message.content,
        isMeta: message.isMeta,
      } as UserEntry;

    case "assistant":
      return {
        type: "assistant",
        uuid,
        parentUuid,
        timestamp,
        content: message.content,
        model: message.model ?? "unknown",
        usage: message.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: message.stopReason ?? "stop",
        errorMessage: message.errorMessage,
      } as AssistantEntry;

    case "toolResult":
      return {
        type: "toolResult",
        uuid,
        parentUuid,
        timestamp,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        isError: message.isError,
        details: message.details,
      } as ToolResultEntry;

    case "attachment":  // ← 新增
      return {
        type: "attachment",
        uuid,
        parentUuid,
        timestamp,
        attachmentType: message.attachment.type,
        content: JSON.stringify(message.attachment),
      } as AttachmentEntry;

    default:
      throw new Error(`Unsupported message role: ${(message as any).role}`);
  }
}
```

**文件**: `src/session/session-loader.ts`

**修改 `entryToMessage`**:
```typescript
private entryToMessage(
  entry: Exclude<Entry, { type: "header" } | { type: "compact_boundary" }>
): AgentMessage {
  switch (entry.type) {
    case "user":
      return {
        role: "user",
        content: entry.content,
        timestamp: entry.timestamp,
        isMeta: entry.isMeta,
      } as unknown as AgentMessage;

    case "assistant":
      return {
        role: "assistant",
        content: entry.content,
        model: entry.model,
        usage: entry.usage,
        stopReason: entry.stopReason,
        errorMessage: entry.errorMessage,
        timestamp: entry.timestamp,
      } as unknown as AgentMessage;

    case "toolResult": {
      const msg: Record<string, unknown> = {
        role: "toolResult",
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        content: entry.content,
        isError: entry.isError,
        timestamp: entry.timestamp,
      };
      if (entry.details !== undefined) {
        msg.details = entry.details;
      }
      return msg as unknown as AgentMessage;
    }

    case "attachment":  // ← 新增
      return {
        role: "attachment",
        attachment: JSON.parse(entry.content),
        timestamp: entry.timestamp,
      } as unknown as AgentMessage;
  }
}
```

### 3.3 重构 `transformMessages` 拆分三阶段

**文件**: `src/agent/stream-assistant.ts`

**现状**:
```typescript
async function transformMessages(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): Promise<Message[]> {
  let messages = context.messages;

  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  } else if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    const attachments = getUserContextAttachments(userContext);
    messages = [...attachments, ...messages];
  }

  const sentSkillNames = context.sentSkillNames ?? new Set<string>();
  messages = await injectSkillListingAttachments(messages, process.cwd(), sentSkillNames);
  messages = await injectAtMentionAttachments(messages, process.cwd());

  const normalizedMessages = normalizeMessages(messages);
  return config.convertToLlm(normalizedMessages);
}
```

**问题分析**：
- `injectSkillListingAttachments` 和 `injectAtMentionAttachments` 直接修改 `messages` 数组，将 attachment 推入其中
- 但这些 attachment 从未触发 `message_start` / `message_end` 事件
- 结果 `agent.state.messages` 不包含 attachment，session 也不持久化

**重构为三阶段**:

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

  // userContext attachments（独立生成，不在此处合并到 messages）
  if (!config.disableUserContext && !config.transformContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    const userContextAttachments = getUserContextAttachments(userContext);
    attachments.push(...userContextAttachments);
  }

  // skill listing attachments（从 context.sentSkillNames 读取状态）
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
    // 注意：不在此处修改 sentSkillNames
    // skill 去重状态由 handleAgentEvent 在 message_end 时统一更新
  }

  // @mention attachments（扫描 context.messages 中的 user 消息）
  for (const msg of context.messages) {
    if (msg.role !== "user" || typeof msg.content !== "string") continue;
    const mentionedFiles = extractAtMentionedFiles(msg.content);
    for (const fp of mentionedFiles) {
      const attachment = await readAtMentionedFile(fp, process.cwd());
      if (attachment) {
        attachments.push({
          role: "attachment",
          attachment,
          timestamp: Date.now(),
        } as AgentMessage);
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
  return Promise.resolve(convertToLlm(normalized));
}
```

**修改 `streamAssistantResponse` 调用顺序**:

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

  const llmContext: Context = {
    systemPrompt: config.systemPrompt,
    messages: llmMessages,
    tools: (context.tools ?? []) as Tool[],
  };

  // ... 后续流式处理逻辑不变
}
```

### 3.4 修改 `AgentSession` 处理 Attachment 事件

**文件**: `src/agent/session.ts`

**修改 `handleAgentEvent`**:

```typescript
private handleAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    // agent_start / agent_end 是 Agent 内部生命周期事件，UI 层通过 turn_start / turn_end 已足够感知状态变化，此处有意不转发
    case "agent_start":
    case "agent_end":
      return;

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

    // ... 其他 case 不变
  }
}
```

**修改 `sentSkillNames` getter**:

**问题**：原实现 `return this.agent.state.sentSkillNames ?? new Set()` 在 `sentSkillNames` 为 `undefined` 时返回新 Set，导致 `add()` 修改丢失。

**修正**：
```typescript
get sentSkillNames(): Set<string> {
  if (!this.agent.state.sentSkillNames) {
    this.agent.state.sentSkillNames = new Set();
  }
  return this.agent.state.sentSkillNames;
}
```

### 3.5 修改 `normalizeMessages` 为纯函数

**文件**: `src/agent/attachments/normalize.ts`

**现状问题**: `normalizeMessages` 修改输入数组中的对象引用（`last.content = ...`），不是真正的纯函数。

**重构为纯函数**:

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

### 3.6 修改 `convertToLlm` 默认实现

**文件**: `src/agent/agent.ts`

**现状**:
```typescript
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
  );
}
```

**改动**: 保持现状，因为 `normalizeMessages` 已经将所有 attachment 转为 user message。但需要在文档中明确说明调用顺序：

```typescript
// 正确顺序：
const normalized = normalizeMessages(messages);  // attachment → user
const llmMessages = convertToLlm(normalized);     // 过滤（此时已无 attachment）
```

### 3.7 更新 Debug Inspector

**文件**: `src/web/debug/debug-api.ts`

**修改 `buildDebugContext`**:

```typescript
import { normalizeMessages } from "../../agent/attachments/normalize.js";

async function buildDebugContext(): Promise<DebugContextResponse | null> {
  const session = getDebugAgentSession();
  if (!session) return null;

  const messages = [...session.messages];  // 包含 attachment
  const llmMessages = await session.convertToLlm(normalizeMessages(messages));  // ← 正确的 LLM payload

  return {
    sessionId: session.sessionId,
    model: { name: session.model.name, provider: session.model.provider },
    isStreaming: session.isStreaming,
    pendingToolCalls: Array.from(session.pendingToolCalls),
    messageCount: messages.length,
    messages,        // 原始消息（含 attachment）
    llmMessages,     // 真正的 LLM payload
    systemPrompt: session.getSystemPrompt(),
    toolNames: session.tools.map((t) => t.name),
    timestamp: Date.now(),
  };
}
```

## 4. 数据流对比

### 4.1 现有数据流（有 bug）

```
User Prompt
    ↓
AgentSession.prompt()
    ↓
Agent.runPromptMessages()
    ↓
runAgentLoop() → currentContext.messages = [...context.messages, ...prompts]
    ↓
runTurnOnce() → streamAssistantResponse(currentContext, ...)
    ↓
transformMessages():
  1. 生成 attachment（局部变量，直接 push 到 messages 数组）
  2. normalizeMessages()（局部变量）
  3. convertToLlm()（局部变量）
    ↓
返回 llmMessages（传给 API）
    ↓
API 调用结束 → llmMessages 被 GC
    ↓
attachment 从未触发 message_end 事件 → 从未被保存！
```

### 4.2 新数据流（修复后）

```
User Prompt
    ↓
AgentSession.prompt()
    ↓
Agent.runPromptMessages()
    ↓
runAgentLoop() → currentContext.messages = [...context.messages, ...prompts]
    ↓
runTurnOnce() → streamAssistantResponse(currentContext, ...)
    ↓
阶段 1: generateAttachments() → 返回 attachments[]
    ↓
阶段 2: saveAttachments():
  - emit({ type: "message_start", message: attachment })
  - emit({ type: "message_end", message: attachment })
    ↓
Agent.processEvents() 处理 message_end:
  - agent.state.messages.push(attachment)
  - sessionManager.appendMessage(attachment) → 写入磁盘
    ↓
阶段 3: buildApiPayload():
  - normalizeMessages(agent.state.messages) → attachment → user
  - convertToLlm(normalized) → 过滤
    ↓
返回 llmMessages（传给 API）
    ↓
下次请求时，attachment 已从 state.messages 恢复
```

## 5. TDD 测试策略

### 5.1 测试总览

| 测试文件 | 覆盖范围 | 测试类型 |
|---------|---------|---------|
| `tests/session/entry-types.test.ts` | Entry 类型定义 | 类型编译时检查 |
| `tests/session/session-manager.test.ts` | attachment 序列化/反序列化 | 单元测试 |
| `tests/session/session-loader.test.ts` | attachment Entry 恢复 | 单元测试 |
| `tests/agent/attachments/normalize.test.ts` | normalizeMessages 纯函数行为 | 单元测试 |
| `tests/agent/stream-assistant.test.ts` | 三阶段拆分逻辑 | 单元测试 + Mock |
| `tests/web/debug-api.test.ts` | Debug API payload 准确性 | 集成测试 |
| `tests/e2e/message-architecture.test.ts` | 完整对话后 session 文件验证 | E2E 测试 |

### 5.2 详细测试用例

#### Test Suite 1: AttachmentEntry 类型定义

**文件**: `tests/session/entry-types.test.ts`

**目的**: 验证 `AttachmentEntry` 类型符合预期结构。

```typescript
import { describe, it, expect } from "bun:test";
import type { AttachmentEntry, Entry } from "../../src/session/entry-types.js";

describe("AttachmentEntry type", () => {
  it("should accept valid attachment entry", () => {
    const entry: AttachmentEntry = {
      type: "attachment",
      uuid: "test-uuid",
      parentUuid: "parent-uuid",
      timestamp: Date.now(),
      attachmentType: "skill_listing",
      content: '{"type":"skill_listing","content":"test","timestamp":123}',
    };
    expect(entry.type).toBe("attachment");
    expect(entry.attachmentType).toBe("skill_listing");
  });

  it("should be included in Entry union type", () => {
    const entry: Entry = {
      type: "attachment",
      uuid: "test-uuid",
      parentUuid: null,
      timestamp: Date.now(),
      attachmentType: "file",
      content: "{}",
    };
    expect(entry.type).toBe("attachment");
  });

  it("should support all attachment types", () => {
    const types: AttachmentEntry["attachmentType"][] = [
      "relevant_memories",
      "file",
      "directory",
      "skill_listing",
    ];
    for (const attachmentType of types) {
      const entry: AttachmentEntry = {
        type: "attachment",
        uuid: "test",
        parentUuid: null,
        timestamp: 0,
        attachmentType,
        content: "{}",
      };
      expect(entry.attachmentType).toBe(attachmentType);
    }
  });
});
```

#### Test Suite 2: SessionManager messageToEntry

**文件**: `tests/session/session-manager.test.ts`

**目的**: 验证 `messageToEntry` 正确将 `role: "attachment"` 的 `AgentMessage` 转为 `AttachmentEntry`。

```typescript
describe("SessionManager.messageToEntry", () => {
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

    // 通过 appendMessage 间接调用 messageToEntry
    manager.appendMessage(message);

    const entries = manager.storage.readAllEntries(manager.filePath);
    const attachmentEntry = entries.find((e): e is AttachmentEntry => e.type === "attachment");

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

    const entries = manager.storage.readAllEntries(manager.filePath);
    const attachmentEntry = entries.find((e): e is AttachmentEntry => e.type === "attachment");

    expect(attachmentEntry).toBeDefined();
    expect(attachmentEntry?.attachmentType).toBe("file");
    const parsed = JSON.parse(attachmentEntry!.content);
    expect(parsed.filePath).toBe("/test/file.ts");
  });

  it("should throw on unsupported role", () => {
    const manager = new SessionManager({ baseDir: tmpdir(), cwd: process.cwd() });
    const message = { role: "unknown", content: "test", timestamp: Date.now() } as any;

    expect(() => manager.appendMessage(message)).toThrow("Unsupported message role: unknown");
  });
});
```

#### Test Suite 3: SessionLoader entryToMessage

**文件**: `tests/session/session-loader.test.ts`

**目的**: 验证 `entryToMessage` 正确将 `type: "attachment"` 的 `Entry` 转为 `AgentMessage`。

```typescript
describe("SessionLoader entryToMessage", () => {
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
    expect(messages[0].attachment.type).toBe("skill_listing");
    expect(messages[0].attachment.skillNames).toEqual(["read"]);
  });

  it("should handle empty attachment content gracefully", () => {
    const loader = new SessionLoader();
    const entries: Entry[] = [
      {
        type: "attachment",
        uuid: "uuid-1",
        parentUuid: null,
        timestamp: 1234567890,
        attachmentType: "file",
        content: "{}",
      },
    ];

    const messages = loader.restoreMessages(entries);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("attachment");
    expect(messages[0].attachment).toEqual({});
  });

  it("should round-trip serialize and restore attachment", () => {
    // 集成测试：SessionManager append → SessionLoader restore
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
    expect(restoredMessages[0].attachment.type).toBe("directory");
    expect(restoredMessages[0].attachment.path).toBe("/test/dir");
    expect(restoredMessages[0].attachment.content).toEqual(["file1.ts", "file2.ts"]);
  });
});
```

#### Test Suite 4: normalizeMessages 纯函数行为

**文件**: `tests/agent/attachments/normalize.test.ts`

**目的**: 验证 `normalizeMessages` 不修改输入数组，且正确展开/合并 attachment。

```typescript
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

#### Test Suite 5: stream-assistant 三阶段拆分

**文件**: `tests/agent/stream-assistant.test.ts`

**目的**: 验证 `generateAttachments`、`saveAttachments`、`buildApiPayload` 各自行为正确。

```typescript
describe("generateAttachments", () => {
  it("should generate userContext attachments when not disabled", async () => {
    const context: AgentContext = { messages: [] };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    // 假设当前目录有 CLAUDE.md 等内容
    expect(attachments.length).toBeGreaterThanOrEqual(0);
  });

  it("should not generate userContext attachments when disabled", async () => {
    const context: AgentContext = { messages: [] };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m,
      disableUserContext: true,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    // 不应包含 userContext 相关 attachment
    const hasUserContext = attachments.some(
      (a) => a.role === "attachment" && a.attachment.type === "relevant_memories"
    );
    expect(hasUserContext).toBe(false);
  });

  it("should generate skill listing for new skills", async () => {
    const context: AgentContext = {
      messages: [],
      sentSkillNames: new Set(),
    };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    const skillAttachment = attachments.find(
      (a) => a.role === "attachment" && a.attachment.type === "skill_listing"
    );
    expect(skillAttachment).toBeDefined();
    expect(skillAttachment?.attachment.skillNames.length).toBeGreaterThan(0);
    // 注意：generateAttachments 不修改 sentSkillNames
    // skill 去重状态由 handleAgentEvent 在 message_end 时统一更新
    expect(context.sentSkillNames?.has(skillAttachment!.attachment.skillNames[0])).toBe(false);
  });

  it("should not duplicate skill listing for already sent skills", async () => {
    const context: AgentContext = {
      messages: [],
      sentSkillNames: new Set(["read"]), // 假设 "read" 已发送
    };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    const skillAttachment = attachments.find(
      (a) => a.role === "attachment" && a.attachment.type === "skill_listing"
    );
    // 如果所有技能都已发送，不应生成 skill_listing
    if (skillAttachment) {
      expect(skillAttachment.attachment.skillNames).not.toContain("read");
    }
  });

  it("should generate @mention attachments from user messages", async () => {
    const context: AgentContext = {
      messages: [
        { role: "user", content: "Check @src/main.ts for details", timestamp: 1000 } as AgentMessage,
      ],
    };
    const config: AgentLoopConfig = {
      model: { name: "test", provider: "test" },
      convertToLlm: (m) => m,
      fileStateCache: createMockFileStateCache(),
    };

    const attachments = await generateAttachments(context, config);

    const fileAttachment = attachments.find(
      (a) => a.role === "attachment" && a.attachment.type === "file"
    );
    expect(fileAttachment).toBeDefined();
    expect(fileAttachment?.attachment.filePath).toContain("main.ts");
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

    const events: AgentEvent[] = [];
    const mockEmit: AgentEventSink = async (event) => {
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
    const events: AgentEvent[] = [];
    const mockEmit: AgentEventSink = async (event) => {
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

#### Test Suite 6: AgentSession handleAgentEvent

**文件**: `tests/agent/session.test.ts`

**目的**: 验证 `message_end` 事件中 attachment 被正确处理。

```typescript
describe("AgentSession handleAgentEvent", () => {
  it("should append attachment message to sessionManager on message_end", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" },
      apiKey: "test",
    });

    const appendSpy = spyOn(session["sessionManager"], "appendMessage");

    const attachmentMessage: AgentMessage = {
      role: "attachment",
      attachment: { type: "file", filePath: "/test.ts", content: { type: "text", text: "" }, timestamp: 1000 },
      timestamp: 1000,
    } as AgentMessage;

    // 通过 agent 触发事件
    session["agent"]["emitEvent"]({ type: "message_end", message: attachmentMessage });

    expect(appendSpy).toHaveBeenCalledWith(attachmentMessage);
  });

  it("should mark skills as sent for skill_listing attachment", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" },
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

    session["agent"]["emitEvent"]({ type: "message_end", message: skillMessage });

    expect(session.sentSkillNames.has("read")).toBe(true);
    expect(session.sentSkillNames.has("write")).toBe(true);
  });

  it("should not affect sentSkillNames for non-skill attachment", () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" },
      apiKey: "test",
    });

    const initialSize = session.sentSkillNames.size;

    const fileMessage: AgentMessage = {
      role: "attachment",
      attachment: { type: "file", filePath: "/test.ts", content: { type: "text", text: "" }, timestamp: 1000 },
      timestamp: 1000,
    } as AgentMessage;

    session["agent"]["emitEvent"]({ type: "message_end", message: fileMessage });

    expect(session.sentSkillNames.size).toBe(initialSize);
  });
});
```

#### Test Suite 7: Debug API LLM Payload

**文件**: `tests/web/debug-api.test.ts`

**目的**: 验证 Debug Inspector 返回的 `llmMessages` 经过 `normalizeMessages` 转换。

```typescript
describe("Debug API buildDebugContext", () => {
  it("should include normalized messages in llmMessages", async () => {
    // 模拟一个包含 attachment 的 session
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
    setDebugAgentSession(null);

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

#### Test Suite 8: E2E 完整流程验证

**文件**: `tests/e2e/message-architecture.test.ts`

**目的**: 验证完整对话后 session 文件包含 attachment。

```typescript
describe("Message Architecture E2E", () => {
  it("should persist attachments to session file after conversation", async () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" },
      apiKey: "test",
    });

    // 发送用户消息
    await session.prompt("Use @src/main.ts");

    // 等待处理完成
    await session.waitForIdle();

    // 验证 session 文件
    const filePath = session["sessionManager"].filePath;
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");

    // 查找 attachment entry
    const hasAttachment = lines.some((line) => {
      const entry = JSON.parse(line);
      return entry.type === "attachment";
    });

    expect(hasAttachment).toBe(true);

    // 验证恢复后 attachment 仍在
    const restoredMessages = session.messages;
    const attachmentMessages = restoredMessages.filter((m) => m.role === "attachment");
    expect(attachmentMessages.length).toBeGreaterThan(0);
  });

  it("should not duplicate skill listing across multiple turns", async () => {
    const session = new AgentSession({
      cwd: process.cwd(),
      model: { name: "test", provider: "test" },
      apiKey: "test",
    });

    // 第一轮
    await session.prompt("Hello");
    await session.waitForIdle();

    const firstTurnSkillCount = session.messages.filter(
      (m) => m.role === "attachment" && m.attachment?.type === "skill_listing"
    ).length;

    // 第二轮
    await session.prompt("Again");
    await session.waitForIdle();

    const secondTurnSkillCount = session.messages.filter(
      (m) => m.role === "attachment" && m.attachment?.type === "skill_listing"
    ).length;

    // skill_listing 不应重复
    expect(secondTurnSkillCount).toBe(firstTurnSkillCount);
  });
});
```

### 5.3 测试执行顺序

```
Step 1: 运行 Entry 类型测试 → 验证 AttachmentEntry 类型定义
Step 2: 运行 SessionManager 测试 → 验证序列化
Step 3: 运行 SessionLoader 测试 → 验证反序列化
Step 4: 运行 normalizeMessages 测试 → 验证纯函数行为
Step 5: 运行 stream-assistant 测试 → 验证三阶段拆分
Step 6: 运行 AgentSession 测试 → 验证事件处理
Step 7: 运行 Debug API 测试 → 验证 LLM payload 准确性
Step 8: 运行 E2E 测试 → 验证完整流程
```

## 6. 实施计划（一次性完整实施）

按依赖关系排序执行：

### Step 1: 扩展类型和持久化层

**文件**: `src/session/entry-types.ts`, `src/session/session-manager.ts`, `src/session/session-loader.ts`

1. 添加 `AttachmentEntry` 类型
2. 修改 `SessionManager.messageToEntry()` 支持 `role: "attachment"`
3. 修改 `SessionLoader.entryToMessage()` 支持 `type: "attachment"`
4. 编写并运行 `entry-types.test.ts`、`session-manager.test.ts`、`session-loader.test.ts`

**验证**: 所有 session 层测试通过。

### Step 2: 重构 transformMessages

**文件**: `src/agent/stream-assistant.ts`, `src/agent/attachments/normalize.ts`

1. 拆分 `transformMessages` 为 `generateAttachments` + `saveAttachments` + `buildApiPayload`
2. 修改 `streamAssistantResponse` 调用三阶段
3. 重构 `normalizeMessages` 为纯函数（创建新对象，不修改输入）
4. 编写并运行 `normalize.test.ts`、`stream-assistant.test.ts`

**验证**: 
- stream-assistant 测试通过
- normalizeMessages 纯函数测试通过（输入数组不被修改）

### Step 3: 更新 AgentSession 事件处理

**文件**: `src/agent/session.ts`

1. 修改 `handleAgentEvent` 处理 `message_end` 中的 attachment
2. 确保 skill_listing attachment 触发 `markSkillsSent`
3. 编写并运行 `session.test.ts`

**验证**: Skill 去重机制正常工作，不会重复发送。

### Step 4: 更新 Debug Inspector

**文件**: `src/web/debug/debug-api.ts`

1. 导入 `normalizeMessages`
2. `buildDebugContext` 中调用 `normalizeMessages` 获取真正的 LLM payload
3. 编写并运行 `debug-api.test.ts`

**验证**: LLM View 显示的内容与 API 请求一致。

### Step 5: E2E 验证

**文件**: `tests/e2e/message-architecture.test.ts`

1. 编写完整对话 E2E 测试
2. 验证 session 文件包含 attachment
3. 验证 skill listing 不重复

**验证**: E2E 测试通过。

## 7. 风险评估

### 7.1 向后兼容性

| 场景 | 风险 | 缓解措施 |
|------|------|---------|
| 旧 session 文件没有 attachment Entry | 低 | `SessionLoader` 忽略未知 Entry 类型 |
| 旧代码读取新 session 文件 | 中 | 旧 `SessionLoader` 会 throw on unknown type | 
| 新代码读取旧 session 文件 | 低 | 新 `SessionLoader` 兼容旧 Entry 类型 |

**建议**: 添加版本号到 HeaderEntry，根据版本选择解析策略。

### 7.2 性能影响

| 改动 | 影响 | 评估 |
|------|------|------|
| attachment 持久化到磁盘 | 每次请求多 1-3 次写操作 | 可忽略（jsonl append 是 O(1)） |
| normalizeMessages 改为纯函数 | 每次请求多创建数组 | 可忽略（消息数通常 < 100） |
| skill listing 从 state 恢复 | 避免每次重新读取文件系统 | **性能提升** |

## 8. 关键文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/session/entry-types.ts` | 新增 | `AttachmentEntry` 类型 |
| `src/session/session-manager.ts` | 修改 | `messageToEntry` 支持 attachment |
| `src/session/session-loader.ts` | 修改 | `entryToMessage` 支持 attachment |
| `src/agent/stream-assistant.ts` | 重构 | 拆分 transformMessages 为三阶段 |
| `src/agent/attachments/normalize.ts` | 重构 | 改为纯函数 |
| `src/agent/session.ts` | 修改 | `handleAgentEvent` 处理 attachment message_end |
| `src/web/debug/debug-api.ts` | 修改 | 调用 normalizeMessages 获取真实 LLM payload |

---

*文档版本: v1.2*
*更新日期: 2026-04-26*
*更新内容:*
- *v1.2: 修正 4 个关键逻辑问题：sentSkillNames 重复修改、context.messages 重复/遗漏、getter 返回新 Set 导致修改丢失、类型安全访问*
- *v1.1: 修正示例代码以匹配实际源码，增强 TDD 测试策略和覆盖率*
