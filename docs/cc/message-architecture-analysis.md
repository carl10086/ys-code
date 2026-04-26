# CC 消息架构分析 —— 与 ys-code 当前设计的对比

> 分析目标：理解 Claude Code (CC) 的消息生命周期、attachment 持久化机制、normalize 定位，找出 ys-code 当前设计的根本缺陷。

---

## 1. 核心结论

| 维度 | CC (正确设计) | ys-code (当前缺陷) |
|------|--------------|-------------------|
| **messages 包含内容** | user/assistant/toolResult/attachment/system 全部保存在 `state.messages` | 只保存 user/assistant/toolResult，`attachment` 虽被生成但**从未进入** `agent.state.messages` |
| **attachment 生命周期** | 生成 → yield → push 到 toolResults → **合并进 state.messages 持久化** | `transformMessages()` 中生成 → `normalizeMessages()` 转为 user message → API 调用后**全部丢弃** |
| **normalize 定位** | `normalizeMessagesForAPI()` 是纯转换函数，**输入输出都是消息数组，不修改原始消息** | `normalizeMessages()` 在 `transformMessages()` 内部调用，结果不保存 |
| **sessionStore 内容** | 包含完整的对话历史（含 attachment） | 只包含过滤后的消息，丢失了 attachment |
| **LLM View 准确性** | 可以从 `state.messages` 重建出完整的 API payload | `convertToLlm()` 只做了 role 过滤，看不到完整的 LLM payload |

---

## 2. CC 的消息类型定义

CC 使用统一的消息类型 `Message`（`src/types/message.ts`），包含以下子类型：

- `UserMessage` —— 用户输入（含 tool result）
- `AssistantMessage` —— AI 回复
- `AttachmentMessage` —— 附件消息（skill listing、file content、todo reminder 等）
- `SystemMessage` —— 系统消息（compact boundary、tool use summary 等）
- `ProgressMessage` —— 进度消息（显示-only，不发给 API）
- `TombstoneMessage` —— 墓碑消息（用于删除 UI 中的消息）

**关键洞察**：`AttachmentMessage` 是 `Message` 的合法子类型，参与 `state.messages` 的完整生命周期。

---

## 3. CC 的 Attachment 完整生命周期

### 3.1 生成 Attachment

`src/utils/attachments.ts` 提供各类 attachment 生成器：

```typescript
// 文件附件
export type FileAttachment = {
  type: 'file'
  filename: string
  content: FileReadToolOutput
  truncated?: boolean
  displayPath: string
}

// Skill Listing 附件
export type SkillListingAttachment = {
  type: 'skill_listing'
  content: string        // 格式化后的 skill 列表文本
  skillNames: string[]   // 包含的 skill 名称
}

// Todo Reminder 附件
export type TodoReminderAttachment = {
  type: 'todo_reminder'
  content: string
}

// 已编辑文件附件
export type EditedTextFileAttachment = {
  type: 'edited_text_file'
  filename: string
  content: string
}

// ... 还有 memory、agent mention、async hook 等类型
```

### 3.2 包装为 AttachmentMessage

`src/utils/attachments.ts:3201-3210`：

```typescript
export function createAttachmentMessage(
  attachment: Attachment,
): AttachmentMessage {
  return {
    attachment,
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}
```

**注意**：`AttachmentMessage` 是一个完整的 `Message`，有 uuid 和 timestamp，可以被持久化。

### 3.3 获取并注入 Attachment

`src/query.ts:1862-1909`，在工具执行后、下一轮循环前：

```typescript
// 1. 从 command queue 获取 attachment（skill listing、task notification 等）
for await (const attachment of getAttachmentMessages(
  null,
  updatedToolUseContext,
  null,
  queuedCommandsSnapshot,
  [...messagesForQuery, ...assistantMessages, ...toolResults],
  querySource,
)) {
  yield attachment              // ← 发射到 UI
  toolResults.push(attachment)  // ← 加入 toolResults
}

// 2. 从 memory prefetch 获取 attachment
if (pendingMemoryPrefetch && pendingMemoryPrefetch.settledAt !== null) {
  const memoryAttachments = filterDuplicateMemoryAttachments(
    await pendingMemoryPrefetch.promise,
    toolUseContext.readFileState,
  )
  for (const memAttachment of memoryAttachments) {
    const msg = createAttachmentMessage(memAttachment)
    yield msg
    toolResults.push(msg)
  }
}

// 3. 从 skill discovery prefetch 获取 attachment
if (skillPrefetch && pendingSkillPrefetch) {
  const skillAttachments =
    await skillPrefetch.collectSkillDiscoveryPrefetch(pendingSkillPrefetch)
  for (const att of skillAttachments) {
    const msg = createAttachmentMessage(att)
    yield msg
    toolResults.push(msg)
  }
}
```

### 3.4 合并到 state.messages

`src/query.ts:2010-2022`，每轮循环结束时：

```typescript
const next: State = {
  messages: [
    ...messagesForQuery,      // ← 当前轮次的 query messages（含 compact boundary 后的历史）
    ...assistantMessages,     // ← 本轮 AI 回复
    ...toolResults,           // ← ← ← 工具执行结果 + attachments！
  ],
  toolUseContext: toolUseContextWithQueryTracking,
  autoCompactTracking: tracking,
  turnCount: nextTurnCount,
  // ...
}
state = next
```

**关键**：`toolResults` 包含了工具执行结果 **和** attachment messages，一起被合并到 `state.messages` 中。

### 3.5 持久化

CC 的 `queryLoopSnapshotRuntime` 在每轮循环结束时写入 snapshot：

```typescript
await writeQueryLoopSnapshotIfEnabled({
  phase: 'next',
  fullSystemPrompt,
  stateSnapshot: state,  // ← 包含完整的 messages（含 attachment）
})
```

或在查询结束时：

```typescript
await writeQueryEndSnapshotIfEnabled({
  endReason: 'completed',
  stateSnapshot: state,
  messagesOverride: [...messagesForQuery, ...assistantMessages, ...toolResults],
  toolUseContextOverride: toolUseContext,
})
```

---

## 4. CC 的 normalizeMessagesForAPI —— 纯转换函数

### 4.1 函数签名

`src/utils/messages.ts:1989-1992`：

```typescript
export function normalizeMessagesForAPI(
  messages: Message[],
  tools: Tools = [],
): (UserMessage | AssistantMessage)[]
```

**输入**：完整的 `Message[]`（含 attachment、system 等）
**输出**：仅包含 `UserMessage | AssistantMessage` 的数组
**副作用**：无（不修改输入数组）

### 4.2 核心转换步骤

#### 步骤 1：Reorder Attachments

```typescript
const reorderedMessages = reorderAttachmentsForAPI(messages)
```

将 `attachment` 消息向上浮动，直到遇到 `tool result` 或 `assistant message` 为止。

#### 步骤 2：过滤 Virtual 消息

```typescript
.filter(m => !((m.type === 'user' || m.type === 'assistant') && m.isVirtual))
```

`isVirtual` 消息仅用于显示（如 REPL 内部工具调用），不发往 API。

#### 步骤 3：将 Attachment 转换为 UserMessage

```typescript
case 'attachment': {
  const userMsg = createUserMessage({
    content: formatAttachmentForAPI(message.attachment),
    uuid: message.uuid,
    timestamp: message.timestamp,
  })
  // 合并到相邻的 user message
}
```

attachment 被转换为 `user` role 的消息，内容包裹在 `<system-reminder>` 等标签中。

#### 步骤 4：合并连续 User Messages

Bedrock 不支持连续多个 user message，所以 CC 会合并它们：

```typescript
if (lastMessage?.type === 'user') {
  result[result.length - 1] = mergeUserMessages(lastMessage, userMsg)
  return
}
```

#### 步骤 5：过滤不可用的 Tool Reference

如果 tool search 未启用，或某些 tool 已被移除（如 MCP server 断开），过滤掉对应的 `tool_reference` block。

### 4.3 调用时机

`normalizeMessagesForAPI` 在**每次 API 调用前**被调用，是一个纯转换：

```typescript
// query.ts:779-780
const response = await deps.callModel({
  messages: prependUserContext(
    normalizeMessagesForAPI(messagesForQuery, tools),
    userContext
  ),
  systemPrompt: fullSystemPrompt,
  // ...
})
```

**注意**：`normalizeMessagesForAPI` 的返回值**不会**被保存回 `state.messages`，它只在 API 调用时存在。

---

## 5. CC 的 userContext 注入 —— 唯一"临时"的内容

### 5.1 注入位置

`src/query.ts:780`：

```typescript
messages: prependUserContext(
  normalizeMessagesForAPI(messagesForQuery, tools),
  userContext
),
```

### 5.2 prependUserContext 的实现

`src/utils/api.ts`：

```typescript
export function prependUserContext(
  messages: Message[],
  userContext: { [k: string]: string }
): Message[] {
  // 将 userContext 转换为 user message，插入到 messages 最前面
  const contextMessage = createUserMessage({
    content: formatUserContext(userContext),
    isMeta: true,
  })
  return [contextMessage, ...messages]
}
```

### 5.3 为什么 userContext 是临时的

userContext 包含：
- CLAUDE.md 内容（可能随文件编辑而变化）
- 当前日期（每天都在变）
- Git 分支（可能随时切换）

这些内容**不适合持久化**，因为：
1. 它们可能随时间变化
2. 每次请求时重新读取是最准确的
3. 它们不是对话历史的一部分，而是"上下文环境"

---

## 6. 深入源码分析：Attachment 为什么没进入 `agent.state.messages`

### 6.1 数据流追踪

**Step 1：`createContextSnapshot()` 创建副本**

`src/agent/agent.ts:442-448`：
```typescript
private createContextSnapshot(): AgentContext {
  return {
    messages: this._state.messages.slice(),  // ← 浅拷贝
    tools: this._state.tools.slice(),
    sentSkillNames: this._state.sentSkillNames,
  };
}
```

`this._state.messages.slice()` 创建了新的数组对象。此时：
- `agent.state.messages` —— 原始数组
- `context.messages` —— 新数组（副本）

**Step 2：`runAgentLoop()` 再次拷贝**

`src/agent/agent-loop.ts:167-171`：
```typescript
const currentContext: AgentContext = {
  ...context,
  messages: [...context.messages, ...prompts],  // ← 再次创建新数组
};
```

现在有三层：
- `agent.state.messages` —— 原始数组
- `context.messages` —— 第一次拷贝
- `currentContext.messages` —— 第二次拷贝

**Step 3：`transformMessages()` 只操作局部变量**

`src/agent/stream-assistant.ts:31-52`：
```typescript
async function transformMessages(context, config, signal): Promise<Message[]> {
  let messages = context.messages;  // ← 引用 currentContext.messages

  // 所有操作都创建新数组，从不修改 context.messages
  messages = [...attachments, ...messages];           // 新数组
  messages = await injectSkillListingAttachments(...); // 新数组
  messages = await injectAtMentionAttachments(...);    // 新数组

  const normalized = normalizeMessages(messages);      // 新数组
  return config.convertToLlm(normalized);              // 新数组
}
```

**关键**：`messages` 是局部变量，`context.messages`（即 `currentContext.messages`）**从未被修改**。

即使 `transformMessages` 直接 push 到 `context.messages`，也只会修改 `currentContext.messages`，不会影响 `agent.state.messages`。

**Step 4：`agent.state.messages` 只通过 `message_end` 事件更新**

`src/agent/agent.ts:549-553`：
```typescript
case "message_end": {
  logger.debug("Message ended", { role: event.message.role });
  this._state.streamingMessage = undefined;
  this._state.messages = [...this._state.messages, event.message];  // ← 唯一更新点
  break;
}
```

**Step 5：哪些消息触发 `message_end`？**

`src/agent/agent-loop.ts`：
```typescript
// 1. pendingMessages（steering messages）
for (const message of pendingMessages) {
  await emit({ type: "message_end", message });  // ← user role
  currentContext.messages.push(message);
}

// 2. assistant message（在 finalizeStreamMessage 中）
await emit({ type: "message_end", message: finalMessage });  // ← assistant role
```

**attachment 消息从未触发 `message_end` 事件。**

### 6.2 结论：三层断裂

| 层级 | 发生了什么 | 结果 |
|------|----------|------|
| **生成层** | `transformMessages()` 生成 attachment → normalize 为 user message | 局部变量 |
| **上下文层** | `currentContext.messages` 是 `agent.state.messages` 的副本 | 互不影响 |
| **持久化层** | `agent.state.messages` 只通过 `message_end` 事件更新 | attachment 不触发 |

**根本问题**：
- `transformMessages()` 是一条"死胡同"——数据流入后没有任何回流机制
- 不像 CC 的 `toolResults` 会被合并回 `state.messages`
- 不像 pendingMessages 会触发 `message_end` 并 push 到 `currentContext.messages`

---

## 7. ys-code 当前设计的缺陷总结

### 7.1 缺陷 1：Attachment 生成后即丢弃，没有生命周期

**ys-code 的 `transformMessages()`（`stream-assistant.ts:31-52`）**：

```typescript
async function transformMessages(context, config, signal): Promise<Message[]> {
  let messages = context.messages;  // ← 原始 messages（不含 attachment）

  // 第1-3步：生成 attachment 消息
  messages = [...attachments, ...messages];           // userContext → attachment role
  messages = await injectSkillListingAttachments(...); // skill listing → attachment role
  messages = await injectAtMentionAttachments(...);    // @mention → attachment role

  // 第4步：normalize 将 attachment 转为 user message
  const normalized = normalizeMessages(messages);      // attachment → user（<system-reminder>）
  
  // 第5步：convertToLlm 过滤 role
  return config.convertToLlm(normalized);              // 只保留 user/assistant/toolResult
}
```

**问题**：
- `AttachmentMessage` 类型**已定义**（`src/agent/attachments/types.ts:90-97`）
- `role: "attachment"` 的消息**确实被生成了**
- 但 `normalizeMessages()` 将它们转为 `user` message 后，**没有任何东西被保存**
- `transformMessages()` 返回的 `Message[]` 直接传给 `streamFunction`，调用结束后全部丢弃
- 下次请求时，**重新生成**所有 attachment，而不是从历史中恢复

**对比 CC**：
- CC 的 attachment 生成 `AttachmentMessage` → push 到 `toolResults` → 合并到 `state.messages`
- 下次请求时，attachment 已经存在于 `state.messages` 中
- `normalizeMessagesForAPI` 只在 API 调用前**读取** `state.messages`，不做修改

### 6.1 缺陷 1：Attachment 生成后即丢弃，没有生命周期

**ys-code 的 `transformMessages()`（`stream-assistant.ts:31-52`）**：

```typescript
async function transformMessages(context, config, signal): Promise<Message[]> {
  let messages = context.messages;  // ← 原始 messages（不含 attachment）

  // 第1-3步：生成 attachment 消息
  messages = [...attachments, ...messages];           // userContext → attachment role
  messages = await injectSkillListingAttachments(...); // skill listing → attachment role
  messages = await injectAtMentionAttachments(...);    // @mention → attachment role

  // 第4步：normalize 将 attachment 转为 user message
  const normalized = normalizeMessages(messages);      // attachment → user（<system-reminder>）
  
  // 第5步：convertToLlm 过滤 role
  return config.convertToLlm(normalized);              // 只保留 user/assistant/toolResult
}
```

**问题**：
- `AttachmentMessage` 类型**已定义**（`src/agent/attachments/types.ts:90-97`）
- `role: "attachment"` 的消息**确实被生成了**
- 但 `normalizeMessages()` 将它们转为 `user` message 后，**没有任何东西被保存**
- `transformMessages()` 返回的 `Message[]` 直接传给 `streamFunction`，调用结束后全部丢弃
- 下次请求时，**重新生成**所有 attachment，而不是从历史中恢复

**对比 CC**：
- CC 的 attachment 生成 `AttachmentMessage` → push 到 `toolResults` → 合并到 `state.messages`
- 下次请求时，attachment 已经存在于 `state.messages` 中
- `normalizeMessagesForAPI` 只在 API 调用前**读取** `state.messages`，不做修改

### 6.2 缺陷 2：normalizeMessages 的位置错误

**ys-code 的 `normalizeMessages()`（`attachments/normalize.ts:77-109`）**：

```typescript
export function normalizeMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    if (msg.role !== 'attachment') {
      result.push(msg);
      continue;
    }
    const expanded = normalizeAttachment(msg.attachment);
    // 合并到相邻 user message
    const last = result[result.length - 1];
    if (last && last.role === 'user') {
      last.content = last.content + '\n' + first.content;
    }
  }
  return result;
}
```

**问题**：
- `normalizeMessages` 在 `transformMessages()` 内部调用
- 但 `transformMessages()` 的结果不保存
- 所以 normalize 后的内容（`<system-reminder>` 包装）永远丢失

**对比 CC**：
- CC 的 `normalizeMessagesForAPI` 在**每次 API 调用前**独立调用
- 输入是 `state.messages`（包含 attachment）
- 输出仅用于本次 API 调用，不影响原始 messages

### 6.3 缺陷 3：sessionStore 保存的是不完整的历史

**ys-code 的 `sessionManager.appendMessage()`（`session.ts:277-278`）**：

```typescript
case 'message_end': {
  this.sessionManager.appendMessage(event.message);
  this.sessionManager.compactIfNeeded();
}
```

**问题**：
- 只保存触发 `message_end` 事件的消息
- `message_end` 来自 `agent-loop.ts` 的 `emit({ type: 'message_end', message })`
- 这些消息只包括 user prompts 和 assistant responses
- **不包含** skill listing、@mention、userContext 等 attachment

**对比 CC**：
- CC 的 `state.messages` 在每轮循环结束时合并 `toolResults`
- `toolResults` 包含 attachment messages
- snapshot 写入时包含完整的 messages

### 6.4 缺陷 4：convertToLlm 只做过滤，不做转换

**ys-code 的默认 `convertToLlm`（`agent.ts:28-32`）**：

```typescript
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult',
  );
}
```

**问题**：
- 只做了 role 过滤
- 没有将 attachment 转换为 user message
- 没有合并连续 user messages
- 没有处理 `<system-reminder>` 包装

**对比 CC**：
- CC 的 `normalizeMessagesForAPI` 是完整的转换函数
- 将 attachment → user message、system → user message、合并连续 user
- 输出可以直接发给 API

### 6.5 缺陷 5：Debug Inspector 的 LLM View 是虚假的

**ys-code 的 `debug-api.ts:41-43`**：

```typescript
const messages = [...session.messages];
const llmMessages = await session.convertToLlm(messages);
```

**问题**：
- `session.messages` 不包含 attachment
- `convertToLlm` 只做了 role 过滤
- 所以 `llmMessages` 远小于真正传给 LLM 的内容

**对比 CC**：
- CC 如果要展示 LLM View，可以用 `normalizeMessagesForAPI(state.messages)`
- 输入包含完整的 attachment
- 输出是真正的 API payload

---

## 8. 修复方向

### 8.1 短期修复（最小改动）

1. **将 `normalizeMessages` 逻辑移到 `convertToLlm`**
   - 让 `convertToLlm` 不仅过滤 role，还要将 attachment 转换为 user message
   - 但这不能解决 attachment 不在 `messages` 中的问题

2. **在 `debug-api.ts` 中重新运行 `transformMessages`**
   - 暴露 `AgentSession.transformMessages()` 方法
   - `debug-api.ts` 调用它来获取真正的 LLM payload
   - 但这只是修复 Debug Inspector，不解决根本问题

### 8.2 长期修复（对齐 CC 架构）

1. **~~引入 `AttachmentMessage` 类型~~** ✅ **已存在**
   - `src/agent/attachments/types.ts` 已定义 `AttachmentMessage` 和各类 Attachment
   - 通过 declaration merging 扩展了 `CustomAgentMessages`

2. **重构 `transformMessages` 拆分生成与转换**
   - **生成阶段**：`injectSkillListingAttachments` / `injectAtMentionAttachments` 生成 `AttachmentMessage`
   - **保存阶段**：将 `AttachmentMessage` push 到 `agent.state.messages`，触发 `message_end` 事件
   - **转换阶段**：`normalizeMessages` 改为纯函数，仅在 API 调用前将 attachment 转为 user message

3. **更新 `sessionManager.appendMessage()`**
   - 确保 `role: "attachment"` 的消息也被保存到磁盘
   - 可能需要添加 attachment 类型的 Entry 格式

4. **更新 `convertToLlm` / `normalizeMessages`**
   - `normalizeMessages` 改为纯转换函数，不修改输入数组
   - `convertToLlm` 包含 normalize 逻辑，能从 `messages`（含 attachment）重建完整 API payload
   - 输入应包含 `attachment` role 的消息，输出是可直接发给 LLM 的 `Message[]`

5. **更新 `stream-assistant.ts`**
   - `transformMessages` 不再直接修改 messages 数组
   - 先生成 attachment → 保存到 state → 然后调用 normalize + convert

6. **更新 Debug Inspector**
   - LLM View 调用 `normalizeMessages(messages)` 获取真正的 API payload
   - 与 `streamAssistantResponse` 中传给 LLM 的内容一致

---

## 9. 关键文件映射

| CC 文件 | ys-code 对应文件 | 差异 |
|--------|-----------------|------|
| `src/query.ts` | `src/agent/agent-loop.ts` + `src/agent/stream-assistant.ts` | CC 的 attachment 在 query loop 中生成并合并到 state；ys-code 在 stream-assistant 中临时注入 |
| `src/utils/attachments.ts` | `src/agent/attachments/skill-listing.ts` + `src/agent/attachments/normalize.ts` | CC 生成 `AttachmentMessage`；ys-code 直接修改 messages 数组 |
| `src/utils/messages.ts` | `src/agent/attachments/normalize.ts` | CC 的 `normalizeMessagesForAPI` 是纯转换；ys-code 的 `normalizeMessages` 修改输入数组 |
| `src/utils/api.ts` | `src/agent/context/user-context.ts` | 两者都临时注入 userContext，这是唯一正确的设计 |
| `src/query/queryLoopSnapshotRuntime.ts` | `src/session/session-manager.ts` | CC 的 snapshot 包含完整 messages（含 attachment）；ys-code 的 session 只保存过滤后的消息 |

---

## 10. 术语对照表

| CC 术语 | ys-code 术语 | 说明 |
|--------|-------------|------|
| `Message` | `AgentMessage` | 统一消息类型 |
| `AttachmentMessage` | `AttachmentMessage` | **类型已定义**，但生成后未进入 `agent.state.messages` |
| `Attachment` | `Attachment` | 附件内容（skill listing、file 等） |
| `UserMessage` | `AgentMessage (role: 'user')` | 用户消息 |
| `AssistantMessage` | `AgentMessage (role: 'assistant')` | AI 回复 |
| `normalizeMessagesForAPI` | `normalizeMessages` + `convertToLlm` | CC 是纯转换；ys-code 拆分但不完整 |
| `state.messages` | `agent.state.messages` | CC 包含 attachment；ys-code 不包含 |
| `queryLoopSnapshot` | `SessionManager` | CC 的持久化包含完整历史；ys-code 丢失 attachment |

---

*文档生成时间：2026-04-26*
*基于 CC commit: 最新 main 分支*
