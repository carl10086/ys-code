# Skill 机制分析

## 1. 背景与定位

在 Claude Code 中，Skill 不是运行时保留的"文件"形态，而是一种通过 `SKILL.md` 定义出来的 **prompt command**。用户输入 `/` 看到的每一项，内部都统一称为 `Command`，而 skill 最终会变成一个 `type = 'prompt'` 的 Command。

核心设计目标：
1. **统一命令体系**：skill 与内置命令、plugin 命令共享同一套 registry 和调用机制
2. **延迟加载**：skill 不是一加载就把整份 `SKILL.md` 塞给模型，而是先给摘要，真正需要时才加载完整内容
3. **灵活执行**：支持 `inline`（并入当前会话）和 `fork`（子 agent 执行）两种模式

> **ys-code 现状:** 已复刻 `Command` 类型系统和 `type = 'prompt'` 的 skill 加载机制，支持 `.claude/skills/<skill-name>/SKILL.md` 目录格式。

---

## 2. 核心原理

### Skill 生命周期

```
SKILL.md
  → loadSkillsDir.ts 读取并解析
  → createSkillCommand(...)
  → 变成 type = 'prompt' 的 Command
  → commands.ts 注册进命令系统
  → attachments/messages 只给模型看 skill 摘要
  → 模型调用 SkillTool(skill=...)
  → SkillTool 找到对应 Command
  → inline 或 fork 执行
```

### 两阶段上下文注入

| 阶段 | 内容 | 目的 |
|------|------|------|
| **阶段 1: Listing** | skill 名 + description + whenToUse | 让模型知道有哪些 skill 可用 |
| **阶段 2: Execution** | 完整 markdown 内容 + baseDir | 让模型获得完整执行指引 |

---

## 3. 源码实现

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/skills/loadSkillsDir.ts:403-410` | 从 `/skills/` 目录加载 skill，仅支持 `skill-name/SKILL.md` 格式 |
| `src/skills/loadSkillsDir.ts:447-458` | 解析 frontmatter + markdown 正文 |
| `src/skills/loadSkillsDir.ts:180-189` | `createSkillCommand(...)` 组装 `type = 'prompt'` 的 Command |
| `src/commands.ts:460-468` | 命令系统入口，合并所有来源的 Command |
| `src/utils/attachments.ts:2661-2750` | `getSkillListingAttachments()` 生成 skill 摘要给模型 |
| `src/tools/SkillTool/SkillTool.ts:331-345` | `SkillTool` 定义，skill 的执行桥 |

### Command 类型定义

```typescript
// src/types/command.ts:175-206
export type CommandBase = {
  description: string
  name: string
  aliases?: string[]
  argumentHint?: string
  whenToUse?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  loadedFrom?: ...
}

export type Command = CommandBase &
  (PromptCommand | LocalCommand | LocalJSXCommand)
```

三种类型：
- `local`：本地直接执行，如 `/clear`
- `local-jsx`：本地 UI 命令，如 `/help`
- `prompt`：先展开成 prompt，再交给模型，如 `/commit`

### Skill → Command 的关键字段

```typescript
export function createSkillCommand({
  name: skillName,
  description,
  whenToUse,
  allowedTools,
  context,
  agent,
  getPromptForCommand,  // 核心：展开 skill 内容为 prompt
}): Command {
  return {
    type: 'prompt',
    name: skillName,
    description,
    whenToUse,
    allowedTools,
    context,
    agent,
    getPromptForCommand,
  }
}
```

### SkillTool 执行流程

```typescript
// src/tools/SkillTool/SkillTool.ts:331-345
export const SkillTool: Tool<InputSchema, Output, Progress> = buildTool({
  name: SKILL_TOOL_NAME,
  description: async ({ skill }) => `Execute skill: ${skill}`,
  prompt: async () => getPrompt(getProjectRoot()),
})

// 输入 schema
z.object({
  skill: z.string(),
  args: z.string().optional(),
})
```

执行步骤：
1. 接收 `skill` 名和可选 `args`
2. 在 Command registry 中查找对应 Command
3. 校验/鉴权
4. 执行 Command（inline 或 fork）

---

## 4. 与 ys-code 对比

| cc 模块/功能 | ys-code 当前实现 | 状态 | 差异说明 |
|-------------|-----------------|------|---------|
| `Command` 统一类型系统 | `Command` 类型（brand type） | 已对齐 | 三种类型完全复刻 |
| `type = 'prompt'` skill | `type = 'prompt'` skill | 已对齐 | 机制一致 |
| `.claude/skills/<name>/SKILL.md` | 同目录格式 | 已对齐 | 路径一致 |
| `loadSkillsFromSkillsDir()` | `loadSkillsFromSkillsDir()` | 已对齐 | 加载逻辑一致 |
| `createSkillCommand()` | `createSkillCommand()` | 已对齐 | 字段对齐 |
| `getSkillToolCommands()` | `getSkillToolCommands()` | 已对齐 | 获取 skill 列表 |
| `SkillTool` 执行桥 | `SkillTool` | 已对齐 | 输入输出 schema 一致 |
| `inline` 执行模式 | `inline` 执行模式 | 已对齐 | 并入当前会话 |
| `fork` 执行模式 | `fork` 执行模式 | 已对齐 | 走 sub-agent |
| `getPromptForCommand()` | `getPromptForCommand()` | 已对齐 | 展开逻辑一致 |
| Skill search / discovery | 无 | 未实现 | 无 skill 搜索和推荐机制 |
| Workflow commands | 无 | 未实现 | 无 workflow 系统 |
| Plugin skills | 无 | 未实现 | 无 plugin 系统 |

---

## 5. 可借鉴点与建议

> **建议:** [P1] **Skill Discovery 机制**
> 
> cc 支持 skill search，根据当前任务上下文推荐相关 skill。ys-code 当前仅列出所有 skill。建议后续引入基于关键词/描述的 skill 推荐，减少模型上下文负担。

> **建议:** [P2] **Workflow Commands 占位**
> 
> cc 的 `commands.ts` 合并了 `workflowCommands`，允许 skill 之间编排工作流。ys-code 当前无此能力。建议预留 workflow 类型和注册点。

> **建议:** [P2] **Plugin Skills 扩展**
> 
> cc 支持 `pluginSkills` 和 `pluginCommands`，允许第三方扩展命令系统。ys-code 当前仅支持本地 skill 目录。建议后续预留 plugin 加载接口。

> **建议:** [P0] **Command 命名空间隔离**
> 
> cc 中 skill 名称可能与内置命令冲突。ys-code 当前通过加载顺序后覆盖前处理。建议显式引入命名空间或优先级机制，避免意外覆盖。

---

## 6. 参考链接

- **Skill 加载**：`refer/claude-code-haha/src/skills/loadSkillsDir.ts`
- **命令系统**：`refer/claude-code-haha/src/commands.ts:460-468`
- **SkillTool**：`refer/claude-code-haha/src/tools/SkillTool/SkillTool.ts`
- **Skill Listing**：`refer/claude-code-haha/src/utils/attachments.ts:2661-2750`
- **Command 类型**：`refer/claude-code-haha/src/types/command.ts:175-206`
