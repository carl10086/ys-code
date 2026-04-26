# ys-code 消息架构重构方案

> 基于 CC 源码分析，设计长期修复方案，解决 attachment 生命周期断裂、session 持久化不完整、Debug Inspector LLM View 不准确等问题。

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| **对齐 CC 架构** | Attachment 参与完整消息生命周期，可被持久化 |
| **纯转换函数** | `normalizeMessages` 不修改输入，只做 API 格式转换 |
| **准确观测** | Debug Inspector LLM View 显示真正传给 LLM 的完整 payload |
| **向后兼容** | 现有 session 文件可正常读取，新功能渐进式启用 |

---

## 2. 核心设计原则

### 2.1 消息分层模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: API Payload（临时生成，每次请求独立构建）            │
│  - normalizeMessages(agent.state.messages) → user/assistant  │
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
- 输出: `Message[]`（仅 user/assistant/toolResult）
- 不修改输入数组，不保存输出结果

**Rule 3: userContext 保持临时注入**
- CLAUDE.md、日期、分支等动态内容在 API 调用前注入
- 不保存到 session，每次请求重新读取
- 与 CC 设计一致

---

## 3. 具体改动设计

### 3.1 扩展 AgentEvent 类型

**文件**: `src/agent/types.ts`

**现状**:
```typescript
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  // ... tool events
```

**问题**: `message_end` 的 `message` 类型是 `AgentMessage`，但 `AgentMessage` 当前不包含 `attachment` role（虽然类型定义有，但运行时从未使用）。

**改动**: 无需修改类型定义，`AgentMessage` 已包含 `AttachmentMessage`。但需要确保运行时实际发送 `role: "attachment"` 的消息。

### 3.2 扩展 Entry 类型支持 Attachment

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

### 3.3 扩展 SessionManager 支持 Attachment

**文件**: `src/session/session-manager.ts`

**修改 `messageToEntry`**:
```typescript
private messageToEntry(message: AgentMessage): Entry {
  const uuid = crypto.randomUUID();
  const parentUuid = this._lastUuid;
  const timestamp = message.timestamp ?? Date.now();

  switch (message.role) {
    case "user":
      return { type: "user", uuid, parentUuid, timestamp, content: message.content, isMeta: message.isMeta } as UserEntry;

    case "assistant":
      return { type: "assistant", uuid, parentUuid, timestamp, content: message.content, model: message.model ?? "unknown", usage: message.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: message.stopReason ?? "stop", errorMessage: message.errorMessage } as AssistantEntry;

    case "toolResult":
      return { type: "toolResult", uuid, parentUuid, timestamp, toolCallId: message.toolCallId, toolName: message.toolName, content: message.content, isError: message.isError, details: message.details } as ToolResultEntry;

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

**修改 `restoreMessages`**:
```typescript
private entryToMessage(entry: Exclude<Entry, { type: "header" } | { type: "compact_boundary" }>): AgentMessage {
  switch (entry.type) {
    // ... 现有 case

    case "attachment":  // ← 新增
      return {
        role: "attachment",
        attachment: JSON.parse(entry.content),
        timestamp: entry.timestamp,
      } as AgentMessage;

    default:
      throw new Error(`Unsupported entry type: ${(entry as any).type}`);
  }
}
```

### 3.4 重构 `transformMessages` 拆分三阶段

**文件**: `src/agent/stream-assistant.ts`

**现状**:
```typescript
async function transformMessages(context, config, signal): Promise<Message[]> {
  let messages = context.messages;
  // 生成 + 转换混在一起，结果不保存
  messages = [...attachments, ...messages];
  messages = await injectSkillListingAttachments(messages, ...);
  messages = await injectAtMentionAttachments(messages, ...);
  const normalized = normalizeMessages(messages);
  return config.convertToLlm(normalized);
}
```

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
      attachment: { type: "skill_listing", content, skillNames: newSkills.map(s => s.name), timestamp: Date.now() },
      timestamp: Date.now(),
    } as AgentMessage);
    // 标记 skills 已发送
    for (const name of newSkills.map(s => s.name)) {
      sentSkillNames.add(name);
    }
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
  // 将 attachment 添加到当前 context（用于本次请求）
  context.messages.push(...attachments);

  // === 阶段 3: 构建 API Payload ===
  const llmMessages = await buildApiPayload(context.messages, config.convertToLlm);

  const llmContext: Context = {
    systemPrompt: config.systemPrompt,
    messages: llmMessages,
    tools: (context.tools ?? []) as Tool[],
  };

  // ... 后续流式处理逻辑不变
}
```

### 3.5 修改 `AgentSession` 处理 Attachment 事件

**文件**: `src/agent/session.ts`

**修改 `handleAgentEvent`**:

```typescript
private handleAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    // ... 现有 case

    case "message_end": {
      // 保存到 SessionManager（所有 role 的消息，包括 attachment）
      this.sessionManager.appendMessage(event.message);
      this.sessionManager.compactIfNeeded();

      // 如果是 skill_listing attachment，标记 skills 已发送
      if (event.message.role === "attachment" && event.message.attachment.type === "skill_listing") {
        for (const name of event.message.attachment.skillNames) {
          this.sentSkillNames.add(name);
        }
      }

      break;
    }

    // ... 其他 case
  }
}
```

### 3.6 修改 `normalizeMessages` 为纯函数

**文件**: `src/agent/attachments/normalize.ts`

**现状问题**: `normalizeMessages` 修改输入数组中的 `last.content`（合并 attachment 到 user message）。

**重构为纯函数**:

```typescript
export function normalizeMessages(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    if (msg.role !== "attachment") {
      result.push(msg);
      continue;
    }

    const expanded = normalizeAttachment(msg.attachment);
    if (expanded.length === 0) continue;

    // 尝试合并到前一个 user message
    const last = result[result.length - 1];
    if (last && last.role === "user" && typeof last.content === "string") {
      const first = expanded[0];
      if (typeof first.content === "string") {
        // 创建新的 user message 而不是修改原数组
        result[result.length - 1] = {
          ...last,
          content: last.content + "\n" + first.content,
        };
        result.push(...expanded.slice(1));
        continue;
      }
    }

    result.push(...expanded);
  }

  return result;
}
```

### 3.7 修改 `convertToLlm` 默认实现

**文件**: `src/agent/agent.ts`

**现状**:
```typescript
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
  );
}
```

**问题**: 假设输入已经是 `Message[]`（不含 attachment），但如果调用者直接传入含 attachment 的 `AgentMessage[]`，会出错。

**改动**: 保持现状，因为 `normalizeMessages` 已经将所有 attachment 转为 user message。但需要在文档中明确说明调用顺序：

```typescript
// 正确顺序：
const normalized = normalizeMessages(messages);  // attachment → user
const llmMessages = convertToLlm(normalized);     // 过滤（此时已无 attachment）
```

### 3.8 更新 Debug Inspector

**文件**: `src/web/debug/debug-api.ts`

**修改 `buildDebugContext`**:

```typescript
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

**注意**: 需要导入 `normalizeMessages`。

---

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
  1. 生成 attachment（局部变量）
  2. normalizeMessages()（局部变量）
  3. convertToLlm()（局部变量）
    ↓
返回 llmMessages（传给 API）
    ↓
API 调用结束 → llmMessages 被 GC
    ↓
attachment 从未被保存！
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

---

## 5. 实施计划

### Phase 1: 扩展类型和持久化层（低风险）

**文件**: `src/session/entry-types.ts`, `src/session/session-manager.ts`, `src/session/session-loader.ts`

1. 添加 `AttachmentEntry` 类型
2. 修改 `SessionManager.messageToEntry()` 支持 `role: "attachment"`
3. 修改 `SessionLoader.entryToMessage()` 支持 `type: "attachment"`
4. 添加单元测试

**验证**: 现有测试通过，新测试覆盖 attachment Entry 的序列化/反序列化。

### Phase 2: 重构 transformMessages（高风险，核心改动）

**文件**: `src/agent/stream-assistant.ts`, `src/agent/attachments/normalize.ts`

1. 拆分 `transformMessages` 为 `generateAttachments` + `saveAttachments` + `buildApiPayload`
2. 修改 `streamAssistantResponse` 调用三阶段
3. 重构 `normalizeMessages` 为纯函数
4. 更新单元测试

**验证**: 
- 现有 E2E 测试通过
- Debug Inspector LLM View 显示的内容包含 `<system-reminder>`
- Session 文件包含 `type: "attachment"` 的 Entry

### Phase 3: 更新 AgentSession 事件处理（中风险）

**文件**: `src/agent/session.ts`

1. 修改 `handleAgentEvent` 处理 `message_end` 中的 attachment
2. 确保 skill_listing attachment 触发 `markSkillsSent`

**验证**: Skill 去重机制正常工作，不会重复发送。

### Phase 4: 更新 Debug Inspector（低风险）

**文件**: `src/web/debug/debug-api.ts`, `src/web/debug/debug.html.ts`

1. `debug-api.ts` 中调用 `normalizeMessages` 获取真正的 LLM payload
2. 前端页面区分显示 "原始消息" 和 "LLM Payload"

**验证**: LLM View 显示的内容与 API 请求一致。

---

## 6. 风险评估

### 6.1 向后兼容性

| 场景 | 风险 | 缓解措施 |
|------|------|---------|
| 旧 session 文件没有 attachment Entry | 低 | `SessionLoader` 忽略未知 Entry 类型 |
| 旧代码读取新 session 文件 | 中 | 旧 `SessionLoader` 会 throw on unknown type | 
| 新代码读取旧 session 文件 | 低 | 新 `SessionLoader` 兼容旧 Entry 类型 |

**建议**: 添加版本号到 HeaderEntry，根据版本选择解析策略。

### 6.2 性能影响

| 改动 | 影响 | 评估 |
|------|------|------|
| attachment 持久化到磁盘 | 每次请求多 1-3 次写操作 | 可忽略（jsonl append 是 O(1)） |
| normalizeMessages 改为纯函数 | 每次请求多创建数组 | 可忽略（消息数通常 < 100） |
| skill listing 从 state 恢复 | 避免每次重新读取文件系统 | **性能提升** |

### 6.3 测试覆盖

需要新增的测试：
1. `session-manager.test.ts`: attachment Entry 的 append/restore
2. `stream-assistant.test.ts`: 三阶段拆分的单元测试
3. `debug-api.test.ts`: LLM payload 准确性验证
4. `e2e.test.ts`: 完整对话后检查 session 文件包含 attachment

---

## 7. 与 CC 架构的差异（有意的简化）

| 特性 | CC | ys-code（本方案） | 原因 |
|------|-----|-----------------|------|
| Attachment 类型数 | 10+ 种 | 4 种 | 简化，只覆盖核心场景 |
| Attachment reorder | 有（reorderAttachmentsForAPI） | 无 | 简化，假设顺序正确 |
| Virtual message | 有 | 无 | 暂不实现 |
| Tombstone message | 有 | 无 | 暂不实现 |
| System message | 有（compact boundary） | 有 | 已支持 |
| userContext 注入 | prependUserContext | getUserContextAttachments | 等价实现 |
| Skill discovery prefetch | 有 | 无 | 简化，同步获取 |

---

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
| `src/web/debug/debug.html.ts` | 可选 | 区分显示原始消息和 LLM payload |

---

*文档版本: v1.0*
*设计日期: 2026-04-26*
*基准: CC main 分支 vs ys-code main 分支*
