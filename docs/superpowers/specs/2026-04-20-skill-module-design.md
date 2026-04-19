# Skill 模块设计方案

## 概述

实现 ys-code 项目的 skill 机制，对齐 Claude Code (CC) 的 skill 系统。Skill 是用 `SKILL.md` 定义出来的 prompt command，用户可通过 `/<skill-name>` 触发，模型可通过 SkillTool 调用。

## 目标

- 用户可直接 `/brainstorming` 等 slash command 触发 skill
- `/skills` 命令可以查看所有可用 skill 列表
- 模型可通过 `SkillTool(skill="brainstorming")` 调用 skill
- 第一阶段只支持 inline 模式（skill 内容展开到当前对话）

## 架构

```
.claude/skills/<name>/SKILL.md
         │
         ▼
┌────────────────────────────────────────┐
│  src/skills/loadSkillsDir.ts           │
│  - loadSkillsFromSkillsDir()           │
│  - parseSkillFrontmatterFields()        │
│  - createSkillCommand()                 │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  src/commands/types.ts                 │
│  - PromptCommand 类型定义               │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  src/commands/index.ts                  │
│  - 统一命令注册（local + prompt）        │
│  - findCommand() 查找 skill             │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  src/tools/skillTool.ts                │
│  - 模型调用 skill 的执行桥               │
│  - getPromptForCommand() 展开内容       │
└────────────────────────────────────────┘
```

## 实现详情

### 1. 类型定义

**文件**: `src/commands/types.ts`

新增 `PromptCommand` 类型（对应 CC 的 `type = 'prompt'`）：

```typescript
// prompt command：skill 内容展开到当前对话
export interface PromptCommand extends CommandBase {
  type: 'prompt'
  /** 进度提示信息 */
  progressMessage: string
  /** 内容长度（用于 token 估算） */
  contentLength: number
  /** 参数名列表 */
  argNames?: string[]
  /** 允许使用的工具列表 */
  allowedTools?: string[]
  /** 指定使用的模型 */
  model?: string
  /** 来源标识 */
  source: 'projectSettings' | 'userSettings' | 'bundled'
  /** 是否禁用模型调用 */
  disableModelInvocation?: boolean
  /** 是否可被用户直接调用 */
  userInvocable?: boolean
  /** 使用场景描述 */
  whenToUse?: string
  /** 参数提示文本 */
  argumentHint?: string
  /** effort 级别 */
  effort?: string
  /** 展开 prompt 内容 */
  getPromptForCommand(
    args: string,
    toolUseContext: ToolUseContext,
  ): Promise<ContentBlockParam[]>
}

export type Command = LocalCommand | LocalJSXCommand | PromptCommand
```

### 2. Frontmatter 解析

**文件**: `src/skills/frontmatter.ts`（复用 CC 的 `frontmatterParser.ts` 逻辑）

支持的 frontmatter 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Skill 显示名称 |
| `description` | string | Skill 描述 |
| `context` | 'inline' \| 'fork' | 执行模式（第一阶段只支持 inline） |
| `agent` | string | fork 模式使用的 agent 类型 |
| `allowed-tools` | string[] | 允许使用的工具 |
| `argument-hint` | string | 参数提示 |
| `arguments` | string \| string[] | 参数名列表 |
| `when_to_use` | string | 使用场景 |
| `model` | string | 指定模型 |
| `effort` | string | effort 级别 |

**复用 CC 的工具函数**（通过符号链接或直接复制）：
- `parseFrontmatter()` - 解析 YAML frontmatter
- `parseSkillFrontmatterFields()` - 解析 skill 专用字段
- `parseArgumentNames()` - 解析 arguments 字段

### 3. Skill 加载器

**文件**: `src/skills/loadSkillsDir.ts`

```typescript
/**
 * 从 skills 目录加载所有 skill
 * @param basePath - .claude/skills 目录路径
 * @param source - 配置来源 (projectSettings | userSettings)
 */
export async function loadSkillsFromSkillsDir(
  basePath: string,
  source: 'projectSettings' | 'userSettings',
): Promise<PromptCommand[]>
```

**加载流程**:
1. 扫描 `basePath` 下的每个子目录
2. 读取 `skill-name/SKILL.md`
3. 解析 frontmatter + markdown 正文
4. 调用 `createSkillCommand()` 生成 PromptCommand
5. 返回所有加载的 skill

**SKILL.md 格式**:
```
---
name: brainstorming
description: "You MUST use this before any creative work..."
---

# Skill 内容...
```

### 4. 命令注册

**文件**: `src/commands/index.ts`

```typescript
import { loadSkillsFromSkillsDir } from '../skills/loadSkillsDir.js'

export async function getCommands(): Promise<Command[]> {
  const skills = await loadSkillsFromSkillsDir('.claude/skills', 'projectSettings')
  return [
    ...skills,        // skill 命令（type='prompt'）
    ...COMMANDS,      // 内置命令（exit, clear, tools, help, system, skills）
  ]
}

export function findCommand(
  commandName: string,
  commands: Command[] = COMMANDS, // 需要改为异步获取
): Command | undefined
```

**注意**: `getCommands()` 改为异步，返回的 `COMMANDS` 变为动态加载。

### 4.1 /skills 命令

**文件**: `src/commands/skills/`（新增）

`/skills` 是一个 local 命令，用于列出所有可用的 skill：

```typescript
// src/commands/skills/index.ts
export default {
  name: 'skills',
  description: 'List all available skills',
  async call(): Promise<CommandResult> {
    const skills = await loadSkillsFromSkillsDir('.claude/skills', 'projectSettings')
    const list = skills
      .map(s => `  /${s.name} - ${s.description}`)
      .join('\n')
    return { type: 'text', value: `Available skills:\n${list}` }
  }
}
```

### 5. SkillTool

**文件**: `src/tools/skillTool.ts`

```typescript
export interface SkillTool {
  name: 'Skill'
  description: 'Execute a skill by name'

  input: z.object({
    skill: z.string().describe('Skill name to execute'),
    args: z.string().optional().describe('Arguments to pass to the skill'),
  })

  execute: async (
    input: { skill: string; args?: string },
    context: ToolUseContext,
  ) => Promise<ToolResult>
}
```

**执行流程**:
1. 根据 skill 名查找对应的 PromptCommand
2. 调用 `command.getPromptForCommand(args, context)`
3. 返回展开后的 prompt 内容（ContentBlockParam[]）
4. 结果注入到当前对话

### 6. Session 集成

**文件**: `src/agent/session.ts`

```typescript
// 初始化时加载 skills
const skills = await loadSkillsFromSkillsDir('.claude/skills', 'projectSettings')
const commands = [...skills, ...builtinCommands]

// SkillTool 注册到 tools
const tools = [
  createReadTool(cwd),
  createWriteTool(cwd),
  createEditTool(cwd),
  createBashTool(cwd),
  createGlobTool(cwd),
  createSkillTool(commands),  // 新增
]
```

## 文件结构

```
src/
├── commands/
│   ├── types.ts              # 新增 PromptCommand 类型
│   ├── index.ts              # 修改：异步 getCommands()
│   └── ...
├── skills/
│   ├── loadSkillsDir.ts      # 新增：skill 加载逻辑
│   ├── frontmatter.ts        # 新增：frontmatter 解析（复用 CC 逻辑）
│   └── index.ts              # 新增：导出
├── tools/
│   └── skillTool.ts          # 新增：SkillTool
└── agent/
    └── session.ts            # 修改：集成 skill 加载
```

## 暂不包含（后续实现）

- `context: fork` 执行模式（需要子 agent 支持）
- `shell` frontmatter 和 `!` 反引号执行
- legacy `/commands/` 目录支持
- MCP skill 支持
- hook 机制

## 成功标准

1. `/brainstorming` 能正常触发 skill
2. `/skills` 能查看所有可用 skill 列表
3. SkillTool(skill="brainstorming") 能正常调用 skill
4. skill 内容正确展开到当前对话
