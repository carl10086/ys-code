# Skill Listing 设计文档

> **状态**: 设计评审中

## 背景

当前 `ys-code` 的 Skill 系统存在一个关键缺口：**AI 不知道有哪些 skills 可用**。

Claude Code (CC) 的做法是：在**第一条用户消息**发送给 LLM 时，自动附加一个 `skill_listing` attachment，列出所有可用 skills 的名称、描述和使用时机。这让 AI 知道可以调用哪些 skill，从而在合适的场景主动触发。

`ys-code` 目前没有这个机制，导致：
- AI 不知道 `.claude/skills/` 下有哪些 skill
- AI 不会主动调用 skill，只能被动等待用户输入 "执行 xxx skill"
- Skill 系统的价值大打折扣

## 目标

1. **Skill Listing 注入**：在首次用户消息时，自动将可用 skills 列表附加给 LLM
2. **增量更新**：后续对话中若 skills 有变化（新增），只发送新增的 skills
3. **SkillTool 描述优化**：让 SkillTool 的描述更明确，告诉 AI 可以通过 `skill_listing` 发现可用 skills

## CC 源码确认

### 注入时机

CC 的 `processTextPrompt.ts` 构建消息数组为：
```typescript
return {
  messages: [userMessage, ...attachmentMessages],  // attachment 在 user message 之后
  shouldQuery: true,
}
```

`attachmentMessages` 包含 `skill_listing`（通过 `getAttachments` 中的 `maybe('skill_listing', ...)` 收集）。所以 CC 实际上是把 skill_listing **放在第一条 user message 之后**，后续 message processing 会把它合并进第一条 user message。

### 去重机制

CC 使用 `sentSkillNames: Map<agentKey, Set<string>>` 维护每个 agent 的已发送技能：
```typescript
const agentKey = toolUseContext.agentId ?? ''
let sent = sentSkillNames.get(agentKey)
if (!sent) {
  sent = new Set()
  sentSkillNames.set(agentKey, sent)
}
// Find skills we haven't sent yet
const newSkills = allCommands.filter(cmd => !sent.has(cmd.name))
```

### 格式

CC 的 `formatCommandDescription`:
```typescript
function getCommandDescription(cmd: Command): string {
  const desc = cmd.whenToUse
    ? `${cmd.description} - ${cmd.whenToUse}`
    : cmd.description
  return desc
}

function formatCommandDescription(cmd: Command): string {
  return `- ${cmd.name}: ${getCommandDescription(cmd)}`
}
```

## 方案设计

### 1. 新增 Attachment 类型

**文件**: `src/agent/attachments/types.ts`

```typescript
/** Skill listing attachment - 告诉 LLM 有哪些 skills 可用 */
export interface SkillListingAttachment {
  type: "skill_listing"
  /** 格式化后的 skills 列表文本 */
  content: string
  /** 本次包含的 skill 名称列表（用于去重） */
  skillNames: string[]
}

export type Attachment = 
  | RelevantMemoriesAttachment 
  | FileAttachment 
  | DirectoryAttachment
  | SkillListingAttachment
```

### 2. 格式化函数

**文件**: `src/agent/attachments/skill-listing.ts`（新建）

```typescript
import type { PromptCommand } from "../../commands/types.js"

/**
 * 格式化 skill 列表文本，完全复用 CC 格式
 * 格式："- name: description - whenToUse"
 */
export function formatSkillListing(commands: PromptCommand[]): string {
  return commands
    .filter(cmd => cmd.type === "prompt")
    .map(cmd => {
      const desc = cmd.whenToUse
        ? `${cmd.description} - ${cmd.whenToUse}`
        : cmd.description
      return `- ${cmd.name}: ${desc}`
    })
    .join("\n")
}
```

### 3. 去重状态管理

**位置**: `AgentSession` 实例（`src/agent/session.ts`）

```typescript
export class AgentSession {
  // ... 现有字段
  /** 已发送给 LLM 的 skill 名称集合（用于去重） */
  private sentSkillNames: Set<string> = new Set()
}
```

新增方法：
```typescript
/** 获取尚未发送的 skills */
getNewSkills(allSkills: PromptCommand[]): PromptCommand[] {
  return allSkills.filter(s => !this.sentSkillNames.has(s.name))
}

/** 标记 skills 已发送 */
markSkillsSent(skillNames: string[]): void {
  for (const name of skillNames) {
    this.sentSkillNames.add(name)
  }
}
```

### 4. 注入时机和位置

**注入位置**: `src/agent/stream-assistant.ts`

在 `userContext` attachments 之后、`@mention` 之前调用：

```typescript
// 在 userContext 之后、@mention 之前
messages = await injectSkillListingAttachments(messages, process.cwd(), agentSession);
```

`injectSkillListingAttachments` 实现：

```typescript
async function injectSkillListingAttachments(
  messages: AgentMessage[],
  cwd: string,
  agentSession: AgentSession,
): Promise<AgentMessage[]> {
  // 找到第一条 user message
  const firstUserIndex = messages.findIndex(m => m.role === "user")
  if (firstUserIndex === -1) return messages

  // 获取所有可用 skills
  const commands = await getCommands(join(cwd, ".claude/skills"))
  const promptCommands = commands.filter((cmd): cmd is PromptCommand => cmd.type === "prompt")

  // 获取新增 skills（去重）
  const newSkills = agentSession.getNewSkills(promptCommands)
  if (newSkills.length === 0) return messages

  // 格式化
  const content = formatSkillListing(newSkills)
  const attachment: SkillListingAttachment = {
    type: "skill_listing",
    content,
    skillNames: newSkills.map(s => s.name),
  }

  // 标记已发送
  agentSession.markSkillsSent(newSkills.map(s => s.name))

  // 插入到第一条 user message 之后
  return [
    ...messages.slice(0, firstUserIndex + 1),
    { role: "attachment", attachment, timestamp: Date.now() } as AgentMessage,
    ...messages.slice(firstUserIndex + 1),
  ]
}
```

### 5. normalizeAttachment 处理

**文件**: `src/agent/attachments/normalize.ts`

```typescript
case "skill_listing": {
  const content = [
    "<system-reminder>",
    "You can use the following skills:",
    "",
    attachment.content,
    "",
    "To use a skill, call the SkillTool with the skill name.",
    "</system-reminder>",
    "",
  ].join("\n")
  return [{ role: "user", content, timestamp: attachment.timestamp }]
}
```

### 6. SkillTool 描述更新

**文件**: `src/agent/tools/skill.ts`

当前描述过于简略，需要告诉 AI 如何发现和使用 skills。

**新描述**：
```
Execute a skill by name.

The first user message includes a skill listing that describes all available skills and when to use them. Use that listing to choose the right skill for the task.

Call this tool with the exact skill name from the listing.
```

### 7. 数据流图

```
用户输入 → AgentSession.steer() → streamAssistantResponse()
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                    [userContext]                   [injectSkillListing]
                    attachments                      - 找到第一条 user msg
                          │                         - 获取新增 skills
                          │                         - 插入 attachment
                          ▼                               │
                    [@mention]                              │
                    attachments                            │
                          │                               │
                          ▼                               ▼
                    [normalizeMessages] ←── 合并到第一条 user msg
                          │
                          ▼
                    [convertToLlm]
                          │
                          ▼
                    [streamSimple]
```

## 非目标（明确不做）

1. **Budget 控制**：不限制 skill listing 的长度，发送全部新增 skills
2. **Skill 删除/修改检测**：sentSkillNames 只增不减，不处理 skills 被删除或修改的场景
3. **运行时动态加载**：不监听 `.claude/skills/` 目录变化，只在每次发送时重新扫描

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/agent/attachments/types.ts` | 修改 | 新增 `SkillListingAttachment` 类型 |
| `src/agent/attachments/skill-listing.ts` | 新建 | `formatSkillListing`, `injectSkillListingAttachments` |
| `src/agent/attachments/normalize.ts` | 修改 | 新增 `skill_listing` case |
| `src/agent/stream-assistant.ts` | 修改 | 调用 `injectSkillListingAttachments` |
| `src/agent/session.ts` | 修改 | 添加 `sentSkillNames` Set 及相关方法 |
| `src/agent/tools/skill.ts` | 修改 | 更新 SkillTool 描述 |

## 测试策略

1. **Unit test**：`formatSkillListing` 格式化逻辑
2. **Unit test**：`injectSkillListingAttachments` 插入位置（各种 messages 数组形态）
3. **Integration test**：`debug-agent-chat.ts` 启动后，观察第一条消息的 system-reminder 中是否包含 skills 列表
4. **去重测试**：连续两次 steer，第二次不发送 skill listing

## 验收标准

- [ ] 启动 `debug-agent-chat.ts`，第一条用户消息后，LLM 收到的消息中包含 skills 列表
- [ ] skills 列表格式与 CC 一致（`- name: desc - whenToUse`）
- [ ] 连续对话时，已发送的 skills 不再重复发送
- [ ] SkillTool 描述告诉 AI 如何发现和使用 skills
- [ ] 不引入 budget 控制逻辑（代码中没有相关计算）
