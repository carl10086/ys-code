# SkillTool 消息注入设计

> **目标**：让 SkillTool 返回的 skill 内容能作为对话消息注入到 LLM 上下文中，使模型必须"处理"skill 内容。

## 背景

当前 SkillTool 只是把 skill 内容作为 tool result 文本返回，模型可以忽略它继续对话。

CC 的 SkillTool 通过 `newMessages` + `contextModifier` 机制，将 skill 内容作为 `role: user, isMeta: true` 的消息注入对话，使模型必须处理。

## 设计方案

### 核心机制

```
Agent 调用 SkillTool("brainstorming")
    ↓
tool-execution.ts 执行 SkillTool.execute()
    ↓
返回 { content: [], details: {...}, newMessages: [metaUserMsg], contextModifier }
    ↓
tool-execution.ts 注入 newMessages → currentContext.messages
    ↓
调用 contextModifier 修改 messages（注入 allowedTools 限制）
    ↓
继续 agent loop，下一轮 LLM 请求时带上这些消息
```

### 类型变更

**文件**: `src/agent/types.ts`

```typescript
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[]
  details: T
  /** 注入到消息列表的新消息（UI 隐藏，LLM 可见） */
  newMessages?: AgentMessage[]
  /** 上下文修改器 */
  contextModifier?: (messages: AgentMessage[]) => AgentMessage[]
}
```

**文件**: `src/core/ai/types.ts`

```typescript
interface UserMessage {
  role: "user"
  content: string | (TextContent | ImageContent)[]
  timestamp: number
  /** 是否为 meta 消息（UI 隐藏，LLM 可见） */
  isMeta?: boolean
}
```

### 实现步骤

#### Step 1: 扩展 AgentToolResult 类型

- 在 `src/agent/types.ts` 的 `AgentToolResult` 接口添加 `newMessages` 和 `contextModifier` 字段

#### Step 2: 扩展 UserMessage 类型

- 在 `src/core/ai/types.ts` 的 `UserMessage` 接口添加 `isMeta` 字段

#### Step 3: 修改 tool-execution.ts 处理 newMessages

- 在 `executePreparedToolCall()` 返回值中提取 `newMessages`
- 在 `executeToolCallsSequential()` 和 `executeToolCallsParallel()` 中将 `newMessages` 注入到 `currentContext.messages`

#### Step 4: 创建 SkillTool (src/agent/tools/skill.ts)

- 位置：`src/agent/tools/skill.ts`（已创建）
- `execute()` 逻辑：
  1. 找到对应的 PromptCommand
  2. 调用 `getPromptForCommand()` 获取 skill 内容（读取文件由它负责）
  3. 将内容包装为 `metaUserMessage`：`{ role: "user", content: textContent, isMeta: true }`
  4. 创建 `contextModifier`：注入 `allowedTools` 到 `toolPermissionContext`
  5. 返回 `{ content: [], details: {...}, newMessages: [metaUserMessage], contextModifier }`

#### Step 5: 注册 SkillTool 到 session

- 在 `AgentSession` 初始化时调用 `createSkillTool()` 并注册到 `agent.state.tools`

### 数据流详解

```
1. User: "/brainstorming"
   ↓
2. Session 解析 slash command，识别为 prompt 类型 skill
   ↓
3. Agent 调用 SkillTool(skill="brainstorming")
   ↓
4. SkillTool.execute():
   - command = find PromptCommand("brainstorming")
   - contentBlocks = command.getPromptForCommand("")
   - textContent = "Skill content here..."
   - metaMessage = { role: "user", content: textContent, isMeta: true, timestamp: now }
   - modifier = (msgs) => { /* 注入 allowedTools */ return msgs }
   - return { content: [], details: { success: true }, newMessages: [metaMessage], contextModifier }
   ↓
5. tool-execution.ts:
   - currentContext.messages.push(...newMessages)
   - contextModifier(currentContext.messages)
   ↓
6. Agent 下一轮请求 LLM 时，messages 包含 metaMessage
   ↓
7. LLM "看到" skill 内容并开始处理
```

### contextModifier 实现细节

```typescript
contextModifier: (messages: AgentMessage[]) => {
  // skill 的 allowedTools 限制通过此机制注入
  // 当前实现为占位，后续可在 ToolUseContext 中存储 allowedTools
  return messages
}
```

注意：`contextModifier` 的具体实现（allowedTools 限制）需要与 `ToolUseContext` 配合，当前为最小化实现。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agent/types.ts` | 修改 | AgentToolResult 添加 newMessages/contextModifier |
| `src/core/ai/types.ts` | 修改 | UserMessage 添加 isMeta |
| `src/agent/tool-execution.ts` | 修改 | 处理 newMessages 注入 |
| `src/agent/tools/skill.ts` | 创建/覆盖 | SkillTool 实现 |
| `src/agent/tools/index.ts` | 修改 | 导出 createSkillTool |
| `src/agent/session.ts` | 修改 | 注册 SkillTool |

## 成功标准

1. 调用 `SkillTool(skill="brainstorming")` 后，skill 内容作为 meta user 消息注入到对话
2. 模型必须处理 skill 内容（不能忽略）
3. allowedTools 限制可以通过 contextModifier 注入
4. UI 上不显示 meta 消息（isMeta: true）

## 待后续版本实现

- [ ] `contextModifier` 完整实现（allowedTools 限制生效）
- [ ] 权限检查系统
- [ ] Forked 执行模式
- [ ] !command 引用展开
