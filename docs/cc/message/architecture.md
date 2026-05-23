# 消息架构分析

> 分析目标：理解 Claude Code (CC) 的消息生命周期、Attachment 持久化机制、normalize 定位，对比 ys-code 当前设计的差异，提出对齐建议。
>
> 基准版本：CC main 分支 vs ys-code main 分支（2026-04-26）

---

## 1. 背景与定位

Claude Code (CC) 使用统一的消息类型 `Message` 贯穿整个 Agent 生命周期。所有消息（user、assistant、toolResult、attachment、system）全部保存在 `state.messages` 中，API 调用前通过纯转换函数 `normalizeMessagesForAPI()` 生成临时 Payload。

ys-code 当前的设计存在根本差异：attachment 虽被生成但从未进入 `agent.state.messages`，导致 session 持久化不完整、Debug Inspector 的 LLM View 不准确。

| 维度 | CC（正确设计） | ys-code（当前缺陷） |
|------|--------------|-------------------|
| **messages 包含内容** | user/assistant/toolResult/attachment/system 全部保存在 `state.messages` | 只保存 user/assistant/toolResult，`attachment` 虽被生成但**从未进入** `agent.state.messages` |
| **attachment 生命周期** | 生成 → yield → push 到 toolResults → **合并进 state.messages 持久化** | `transformMessages()` 中生成 → `normalizeMessages()` 转为 user message → API 调用后**全部丢弃** |
| **normalize 定位** | `normalizeMessagesForAPI()` 是纯转换函数，**输入输出都是消息数组，不修改原始消息** | `normalizeMessages()` 在 `transformMessages()` 内部调用，结果不保存 |
| **sessionStore 内容** | 包含完整的对话历史（含 attachment） | 只包含过滤后的消息，丢失了 attachment |
| **LLM View 准确性** | 可以从 `state.messages` 重建出完整的 API payload | `convertToLlm()` 只做了 role 过滤，看不到完整的 LLM payload |

> **ys-code 现状:** 上述缺陷在 2026-04-26 的 main 分支中仍然存在，未修复。

---

## 2. 核心原理

### 2.1 消息类型定义

CC 使用统一的消息类型 `Message`（`src/types/message.ts`），包含以下子类型：

| 类型 | 说明 |
|------|------|
| `UserMessage` | 用户输入（含 tool result） |
| `AssistantMessage` | AI 回复 |
| `AttachmentMessage` | 附件消息（skill listing、file content、todo reminder 等） |
| `SystemMessage` | 系统消息（compact boundary、tool use summary 等） |
| `ProgressMessage` | 进度消息（显示-only，不发给 API） |
| `TombstoneMessage` | 墓碑消息（用于删除 UI 中的消息） |

**关键洞察**：`AttachmentMessage` 是 `Message` 的合法子类型，参与 `state.messages` 的完整生命周期。

### 2.2 消息分层模型

CC 的消息架构可分为三层：

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

### 2.3 关键规则

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

## 3. 源码实现

### 3.1 Attachment 完整生命周期

#### 3.1.1 生成 Attachment

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
```

#### 3.1.2 包装为 AttachmentMessage

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

#### 3.1.3 获取并注入 Attachment

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

#### 3.1.4 合并到 state.messages

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

#### 3.1.5 持久化

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

### 3.2 normalizeMessagesForAPI —— 纯转换函数

#### 3.2.1 函数签名

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

#### 3.2.2 核心转换步骤

**步骤 1：Reorder Attachments**

```typescript
const reorderedMessages = reorderAttachmentsForAPI(messages)
```

将 `attachment` 消息向上浮动，直到遇到 `tool result` 或 `assistant message` 为止。

**步骤 2：过滤 Virtual 消息**

```typescript
.filter(m => !((m.type === 'user' || m.type === 'assistant') && m.isVirtual))
```

`isVirtual` 消息仅用于显示（如 REPL 内部工具调用），不发往 API。

**步骤 3：将 Attachment 转换为 UserMessage**

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

**步骤 4：合并连续 User Messages**

Bedrock 不支持连续多个 user message，所以 CC 会合并它们：

```typescript
if (lastMessage?.type === 'user') {
  result[result.length - 1] = mergeUserMessages(lastMessage, userMsg)
  return
}
```

**步骤 5：过滤不可用的 Tool Reference**

如果 tool search 未启用，或某些 tool 已被移除（如 MCP server 断开），过滤掉对应的 `tool_reference` block。

#### 3.2.3 调用时机

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

### 3.3 userContext 注入 —— 唯一"临时"的内容

#### 3.3.1 注入位置

`src/query.ts:780`：

```typescript
messages: prependUserContext(
  normalizeMessagesForAPI(messagesForQuery, tools),
  userContext
),
```

#### 3.3.2 prependUserContext 的实现

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

#### 3.3.3 为什么 userContext 是临时的

userContext 包含：
- CLAUDE.md 内容（可能随文件编辑而变化）
- 当前日期（每天都在变）
- Git 分支（可能随时切换）

这些内容**不适合持久化**，因为：
1. 它们可能随时间变化
2. 每次请求时重新读取是最准确的
3. 它们不是对话历史的一部分，而是"上下文环境"

---

## 4. 与 ys-code 对比

### 4.1 关键文件映射

| CC 文件 | ys-code 对应文件 | 差异 |
|--------|-----------------|------|
| `src/query.ts` | `src/agent/agent-loop.ts` + `src/agent/stream-assistant.ts` | CC 的 attachment 在 query loop 中生成并合并到 state；ys-code 在 stream-assistant 中临时注入 |
| `src/utils/attachments.ts` | `src/agent/attachments/skill-listing.ts` + `src/agent/attachments/normalize.ts` | CC 生成 `AttachmentMessage`；ys-code 直接修改 messages 数组 |
| `src/utils/messages.ts` | `src/agent/attachments/normalize.ts` | CC 的 `normalizeMessagesForAPI` 是纯转换；ys-code 的 `normalizeMessages` 修改输入数组 |
| `src/utils/api.ts` | `src/agent/context/user-context.ts` | 两者都临时注入 userContext，这是唯一正确的设计 |
| `src/query/queryLoopSnapshotRuntime.ts` | `src/session/session-manager.ts` | CC 的 snapshot 包含完整 messages（含 attachment）；ys-code 的 session 只保存过滤后的消息 |

### 4.2 ys-code 当前设计的缺陷分析

#### 缺陷 1：Attachment 生成后即丢弃，没有生命周期

ys-code 的 `transformMessages()`（`stream-assistant.ts:31-52`）：

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

#### 缺陷 2：normalizeMessages 的位置错误

ys-code 的 `normalizeMessages()`（`attachments/normalize.ts:77-109`）：

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

#### 缺陷 3：sessionStore 保存的是不完整的历史

ys-code 的 `sessionManager.appendMessage()`（`session.ts:277-278`）：

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

#### 缺陷 4：convertToLlm 只做过滤，不做转换

ys-code 的默认 `convertToLlm`（`agent.ts:28-32`）：

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

#### 缺陷 5：Debug Inspector 的 LLM View 是虚假的

ys-code 的 `debug-api.ts:41-43`：

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

### 4.3 根因：三层断裂

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

## 5. 可借鉴点与建议

### 5.1 短期修复（最小改动）

> **建议:** [P1] 将 `normalizeMessages` 逻辑移到 `convertToLlm`
> - 让 `convertToLlm` 不仅过滤 role，还要将 attachment 转换为 user message
> - 但这不能解决 attachment 不在 `messages` 中的问题
> - **状态**: 未实施

> **建议:** [P1] 在 `debug-api.ts` 中重新运行 `transformMessages`
> - 暴露 `AgentSession.transformMessages()` 方法
> - `debug-api.ts` 调用它来获取真正的 LLM payload
> - 但这只是修复 Debug Inspector，不解决根本问题
> - **状态**: 未实施

### 5.2 长期修复（对齐 CC 架构）

> **建议:** [P0] 引入 `AttachmentMessage` 类型
> - `src/agent/attachments/types.ts` 已定义 `AttachmentMessage` 和各类 Attachment
> - 通过 declaration merging 扩展了 `CustomAgentMessages`
> - **状态**: 已存在，无需修改

> **建议:** [P0] 重构 `transformMessages` 拆分生成与转换
> - **生成阶段**：`injectSkillListingAttachments` / `injectAtMentionAttachments` 生成 `AttachmentMessage`
> - **保存阶段**：将 `AttachmentMessage` push 到 `agent.state.messages`，触发 `message_end` 事件
> - **转换阶段**：`normalizeMessages` 改为纯函数，仅在 API 调用前将 attachment 转为 user message
> - **状态**: 未实施

> **建议:** [P0] 更新 `sessionManager.appendMessage()`
> - 确保 `role: "attachment"` 的消息也被保存到磁盘
> - 需要添加 attachment 类型的 Entry 格式
> - **状态**: 未实施

> **建议:** [P0] 更新 `convertToLlm` / `normalizeMessages`
> - `normalizeMessages` 改为纯转换函数，不修改输入数组
> - `convertToLlm` 包含 normalize 逻辑，能从 `messages`（含 attachment）重建完整 API payload
> - 输入应包含 `attachment` role 的消息，输出是可直接发给 LLM 的 `Message[]`
> - **状态**: 未实施

> **建议:** [P0] 更新 `stream-assistant.ts`
> - `transformMessages` 不再直接修改 messages 数组
> - 先生成 attachment → 保存到 state → 然后调用 normalize + convert
> - **状态**: 未实施

> **建议:** [P1] 更新 Debug Inspector
> - LLM View 调用 `normalizeMessages(messages)` 获取真正的 API payload
> - 与 `streamAssistantResponse` 中传给 LLM 的内容一致
> - **状态**: 未实施

### 5.3 具体实施计划

#### Phase 1: 扩展类型和持久化层（低风险）

**文件**: `src/session/entry-types.ts`, `src/session/session-manager.ts`, `src/session/session-loader.ts`

1. 添加 `AttachmentEntry` 类型
2. 修改 `SessionManager.messageToEntry()` 支持 `role: "attachment"`
3. 修改 `SessionLoader.entryToMessage()` 支持 `type: "attachment"`
4. 添加单元测试

**验证**: 现有测试通过，新测试覆盖 attachment Entry 的序列化/反序列化。

#### Phase 2: 重构 transformMessages（高风险，核心改动）

**文件**: `src/agent/stream-assistant.ts`, `src/agent/attachments/normalize.ts`

1. 拆分 `transformMessages` 为 `generateAttachments` + `saveAttachments` + `buildApiPayload`
2. 修改 `streamAssistantResponse` 调用三阶段
3. 重构 `normalizeMessages` 为纯函数
4. 更新单元测试

**验证**: 
- 现有 E2E 测试通过
- Debug Inspector LLM View 显示的内容包含 `<system-reminder>`
- Session 文件包含 `type: "attachment"` 的 Entry

#### Phase 3: 更新 AgentSession 事件处理（中风险）

**文件**: `src/agent/session.ts`

1. 修改 `handleAgentEvent` 处理 `message_end` 中的 attachment
2. 确保 skill_listing attachment 触发 `markSkillsSent`

**验证**: Skill 去重机制正常工作，不会重复发送。

#### Phase 4: 更新 Debug Inspector（低风险）

**文件**: `src/web/debug/debug-api.ts`, `src/web/debug/debug.html.ts`

1. `debug-api.ts` 中调用 `normalizeMessages` 获取真正的 LLM payload
2. 前端页面区分显示 "原始消息" 和 "LLM Payload"

**验证**: LLM View 显示的内容与 API 请求一致。

### 5.4 风险评估

#### 向后兼容性

| 场景 | 风险 | 缓解措施 |
|------|------|---------|
| 旧 session 文件没有 attachment Entry | 低 | `SessionLoader` 忽略未知 Entry 类型 |
| 旧代码读取新 session 文件 | 中 | 旧 `SessionLoader` 会 throw on unknown type | 
| 新代码读取旧 session 文件 | 低 | 新 `SessionLoader` 兼容旧 Entry 类型 |

> **建议:** [P1] 添加版本号到 HeaderEntry，根据版本选择解析策略。

#### 性能影响

| 改动 | 影响 | 评估 |
|------|------|------|
| attachment 持久化到磁盘 | 每次请求多 1-3 次写操作 | 可忽略（jsonl append 是 O(1)） |
| normalizeMessages 改为纯函数 | 每次请求多创建数组 | 可忽略（消息数通常 < 100） |
| skill listing 从 state 恢复 | 避免每次重新读取文件系统 | **性能提升** |

### 5.5 与 CC 架构的差异（有意的简化）

| 特性 | CC | ys-code（建议方案） | 原因 |
|------|-----|-------------------|------|
| Attachment 类型数 | 10+ 种 | 4 种 | 简化，只覆盖核心场景 |
| Attachment reorder | 有（reorderAttachmentsForAPI） | 无 | 简化，假设顺序正确 |
| Virtual message | 有 | 无 | 暂不实现 |
| Tombstone message | 有 | 无 | 暂不实现 |
| System message | 有（compact boundary） | 有 | 已支持 |
| userContext 注入 | prependUserContext | getUserContextAttachments | 等价实现 |
| Skill discovery prefetch | 有 | 无 | 简化，同步获取 |

### 5.6 关键文件变更清单

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

## 6. 参考链接

| 资源 | 路径 |
|------|------|
| CC 消息类型定义 | `refer/claude-code-haha/src/types/message.ts` |
| CC Attachment 生成器 | `refer/claude-code-haha/src/utils/attachments.ts` |
| CC Query 主循环 | `refer/claude-code-haha/src/query.ts` |
| CC normalizeMessagesForAPI | `refer/claude-code-haha/src/utils/messages.ts:1989-1992` |
| CC userContext 注入 | `refer/claude-code-haha/src/utils/api.ts` |
| ys-code Attachment 类型 | `src/agent/attachments/types.ts` |
| ys-code normalizeMessages | `src/agent/attachments/normalize.ts` |
| ys-code stream-assistant | `src/agent/stream-assistant.ts` |
| ys-code session-manager | `src/session/session-manager.ts` |
| ys-code debug-api | `src/web/debug/debug-api.ts` |

---

*文档版本: v1.0*
*生成日期: 2026-05-23*
*合并来源: `docs/cc/message-architecture-analysis.md` + `docs/cc/message-architecture-redesign.md`*
