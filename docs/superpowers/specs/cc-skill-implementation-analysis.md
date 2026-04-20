# CC Skill 实现思路分析

## 概述

Claude Code (CC) 的 skill 系统是一套完整的内容注入机制，允许通过 slash command 触发 skill 执行，并将 skill 内容作为隐藏消息（meta message）注入到 AI 对话上下文中。

## 核心概念

### 1. Meta Message

| 属性 | 说明 |
|------|------|
| `isMeta: true` | 消息对 LLM 可见，对 UI 隐藏 |
| `isMeta: undefined/false` | 普通用户消息，正常显示 |

### 2. Skill 命令类型

| 类型 | 说明 |
|------|------|
| `local` | 本地命令，直接执行返回文本 |
| `local-jsx` | 本地命令，渲染 React 组件 |
| `prompt` | Skill 内容展开到对话上下文 |

### 3. Skill 执行路径

**路径 A：用户输入 `/skill-name`**

```
用户输入 /skill-name
    ↓
processSlashCommand() 解析命令
    ↓
getMessagesForPromptSlashCommand()
    ↓
command.getPromptForCommand() 获取 SKILL.md 内容
    ↓
生成两条 UserMessage:
  - metadata (isMeta=false) → UI 显示 "/skill-name"
  - skillContent (isMeta=true) → 发送给 LLM，UI 隐藏
    ↓
返回 SlashCommandResult { messages, shouldQuery: true }
    ↓
handlePromptSubmit 处理 newMessages
    ↓
onQuery(newMessages) → 发送给 LLM
```

**路径 B：LLM 主动调用 SkillTool**

```
LLM 调用 SkillTool
    ↓
SkillTool.call() 执行
    ↓
processPromptSlashCommand() 获取 skill 内容
    ↓
返回 ToolResult { newMessages, contextModifier }
    ↓
mapToolResultToToolResultBlockParam()
    ↓
LLM 收到 tool_result + newMessages
```

## 关键数据结构

### 1. SlashCommandResult

```typescript
interface SlashCommandResult {
  messages: UserMessage[];           // 生成的 UserMessage 数组
  shouldQuery: boolean;              // 是否查询 LLM
  model?: string;                   // 可选的模型覆盖
  effort?: EffortValue;             // 可选的 effort 等级
  command: Command;                 // 命令对象
}
```

### 2. ToolResult (SkillTool 用)

```typescript
interface ToolResult<T = void> {
  data: T;                                    // 输出数据
  newMessages?: Message[];                     // 新消息（meta message）
  contextModifier?: (ctx: Context) => Context; // 上下文修改器
}
```

### 3. Meta Message 格式

```xml
<command-message>skill-name</command-message>
<command-name>/skill-name</command-name>
<command-args>args</command-args>
```

## CC Skill 执行流程详解

### 1. 用户输入 Slash Command

**文件**: `processSlashCommand.tsx`

```typescript
async function getMessagesForPromptSlashCommand(
  command: Command & PromptCommand,
  args: string,
  context: ToolUseContext,
  precedingInputBlocks: ContentBlockParam[] = [],
  imageContentBlocks: ContentBlockParam[] = [],
  uuid?: string
): Promise<SlashCommandResult> {
  // 1. 调用 skill 获取内容
  const result = await command.getPromptForCommand(args, context);

  // 2. 注册到 compaction 持久化
  addInvokedSkill(command.name, skillPath, skillContent, agentId);

  // 3. 生成元数据字符串
  const metadata = formatCommandLoadingMetadata(command.name, args);

  // 4. 创建消息数组
  const messages = [
    createUserMessage({ content: metadata }),          // 可见
    createUserMessage({ content: result, isMeta: true }), // 隐藏
    ...attachmentMessages,
    createAttachmentMessage({ type: 'command_permissions', ... })
  ];

  // 5. 返回 SlashCommandResult
  return { messages, shouldQuery: true, ... };
}
```

### 2. Meta Message 的关键点

**Meta Message 不会被 UI 显示，但会发送给 LLM**

关键机制：
1. `MessageList` 组件通过 `isMeta` 过滤消息
2. `normalizeMessagesForAPI` 保留 `isMeta` 消息继续发送给 LLM

**过滤逻辑** (`VirtualMessageList.tsx`):
```typescript
function computeStickyPromptText(msg: RenderableMessage): string | null {
  if (msg.type === 'user' && (msg.isMeta || msg.isVisibleInTranscriptOnly)) {
    return null;  // 不显示
  }
}
```

**API 发送逻辑** (`normalizeMessagesForAPI`):
```typescript
// isMeta 消息不会被过滤掉
const filtered = messages.filter(m => !m.isVirtual);  // 只过滤 isVirtual
```

### 3. Skill 执行完成后的消息流

**不是立即触发 LLM 响应，而是将消息加入上下文**

CC 的处理方式：
1. Slash command 返回多条消息（包括 meta message）
2. 这些消息通过 `onQuery(newMessages)` 一次性加入对话上下文
3. LLM 在同一个响应中处理用户的原始输入 + meta message

**关键区别**：
- CC 中 `onQuery(newMessages)` 把 meta message 加入 pending messages
- 但这些消息在用户输入的同一个 turn 中处理
- LLM 看到：用户输入 + meta message（skill 内容）

## ys-code 当前实现的差异

### ys-code 当前行为

```
用户输入 /skill-name
    ↓
executeCommand() 返回 { metaMessages: [skillContent] }
    ↓
app.tsx 显示 appendUserMessage(trimmed)
    ↓
session.steer(metaMessage) ← 把 meta message 加入 steer 队列
    ↓
session.prompt(userInput) ← 发送用户输入
    ↓
Steer 队列在 turn 结束后注入 → 但 turn 已经结束！
```

### 问题分析

1. **Steer 队列时机问题**：
   - `steer()` 把消息加入 `steeringQueue`
   - 但 `steeringQueue` 的消息需要在 turn 结束后才会被处理
   - 当前 turn 已经结束了（因为 `session.prompt()` 等待 LLM 响应）

2. **Meta message 应该和用户输入在同一个 turn**：
   - CC 中 meta message 和用户输入在同一个 `onQuery` 调用中发送
   - ys-code 中 meta message 被 `steer()` 加入队列，但此时 turn 已结束

## 方案对比

### 方案 A：Steer 队列修复

修改 `steer()` 机制，让 meta message 在当前 turn 开始前注入。

### 方案 B：直接加入 Agent 上下文

绕过队列机制，直接把 meta message 加入 `agent.state.messages`。

### 方案 C：同步发送

修改 `session.prompt()` 接受多个消息参数，同步发送用户输入 + meta message。

## 参考文件

| 文件 | 作用 |
|------|------|
| `processSlashCommand.tsx` | Slash command 核心处理 |
| `SkillTool.ts` | SkillTool 实现 |
| `messages.ts` | `createUserMessage` 定义 |
| `UserCommandMessage.tsx` | 命令消息 UI 渲染 |
| `VirtualMessageList.tsx` | 消息列表过滤 |
| `normalizeMessagesForAPI.ts` | API 消息处理 |
