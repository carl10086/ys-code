# Skill 模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ys-code 项目的 skill 机制，对齐 CC 的 skill 系统。用户可通过 `/<skill-name>` 触发 skill，模型可通过 SkillTool 调用。

**Architecture:**
- Skill 以 `.claude/skills/<name>/SKILL.md` 格式存储
- 加载器扫描目录并解析 frontmatter 生成 `PromptCommand`
- 命令系统统一注册 local + prompt 类型命令
- SkillTool 是模型调用 skill 的执行桥（inline 模式）

**Tech Stack:** TypeScript, TypeBox (zod alternative), yaml

---

## 文件结构

```
src/
├── commands/
│   ├── types.ts              # 修改: 新增 PromptCommand 类型
│   ├── index.ts              # 修改: 异步 getCommands()
│   ├── skills/               # 新增: /skills 命令
│   │   └── index.ts
├── skills/
│   ├── loadSkillsDir.ts      # 新增: skill 加载逻辑
│   ├── frontmatter.ts        # 新增: frontmatter 解析
│   └── index.ts              # 新增: 导出
├── tools/
│   └── skillTool.ts          # 新增: SkillTool
└── agent/
    └── session.ts            # 修改: 集成 skill 加载和 SkillTool
```

---

## Task 1: 新增 PromptCommand 类型定义

**Files:**
- Modify: `src/commands/types.ts`

**参考:** CC `src/types/command.ts:25-57` 的 `PromptCommand` 类型定义

- [ ] **Step 1: 在 types.ts 添加 PromptCommand 类型**

在 `LocalJSXCommand` 类型定义后添加：

```typescript
// src/commands/types.ts

/** frontmatter 解析后的内容块类型 */
export type SkillContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url' | 'base64'; url?: string; media_type: string; data: string } }

/** prompt command: skill 内容展开到当前对话 */
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
  /** 展开 prompt 内容 */
  getPromptForCommand(args: string): Promise<SkillContentBlock[]>
}

export type Command = LocalCommand | LocalJSXCommand | PromptCommand
```

- [ ] **Step 2: 导出 SkillContentBlock 类型**

在 `src/commands/types.ts` 底部添加导出：

```typescript
export type { SkillContentBlock }
```

- [ ] **Step 3: 验证类型编译**

```bash
npx tsc --noEmit src/commands/types.ts
```

预期: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/commands/types.ts
git commit -m "feat(commands): add PromptCommand type for skill support"
```

---

## Task 2: 创建 frontmatter 解析模块

**Files:**
- Create: `src/skills/frontmatter.ts`
- Create: `src/skills/index.ts`

**参考:** CC `src/utils/frontmatterParser.ts` 和 `src/skills/loadSkillsDir.ts:185-265`

- [ ] **Step 1: 创建 src/skills/frontmatter.ts**

```typescript
// src/skills/frontmatter.ts
import { parse as parseYaml } from 'yaml'

/** Frontmatter 数据结构 */
export interface FrontmatterData {
  name?: string
  description?: string | null
  context?: 'inline' | 'fork' | null
  agent?: string | null
  'allowed-tools'?: string | string[] | null
  'argument-hint'?: string | null
  when_to_use?: string | null
  version?: string | null
  model?: string | null
  'user-invocable'?: string | null
  effort?: string | null
  arguments?: string | string[] | null
  [key: string]: unknown
}

/** 解析后的 markdown */
export interface ParsedMarkdown {
  frontmatter: FrontmatterData
  content: string
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

/**
 * 解析 markdown 内容，提取 frontmatter 和正文
 */
export function parseFrontmatter(
  markdown: string,
): ParsedMarkdown {
  const match = markdown.match(FRONTMATTER_REGEX)

  if (!match) {
    return { frontmatter: {}, content: markdown }
  }

  const frontmatterText = match[1] || ''
  const content = markdown.slice(match[0].length)

  let frontmatter: FrontmatterData = {}
  try {
    const parsed = parseYaml(frontmatterText) as FrontmatterData | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed
    }
  } catch {
    // YAML 解析失败时使用空 frontmatter
  }

  return { frontmatter, content }
}

/**
 * 解析 frontmatter 中的 boolean 值
 */
export function parseBooleanFrontmatter(value: unknown): boolean {
  return value === true || value === 'true'
}

/**
 * 解析 arguments 字段，支持逗号分隔的字符串或字符串数组
 */
export function parseArgumentNames(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(v => String(v)).filter(v => v.length > 0)
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(v => v.length > 0)
  }
  return []
}

/**
 * 解析 skill frontmatter 字段
 */
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  skillName: string,
): {
  displayName: string | undefined
  description: string
  allowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  model: string | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
} {
  // description: 优先使用 frontmatter，否则从 markdown 提取
  let description = ''
  if (frontmatter.description && typeof frontmatter.description === 'string') {
    description = frontmatter.description.trim()
  }
  if (!description) {
    // fallback: 提取第一个 # 标题后的内容作为 description
    const headingMatch = markdownContent.match(/^#\s+(.+)$/m)
    if (headingMatch) {
      description = headingMatch[1]!.trim()
    } else {
      description = skillName
    }
  }

  // allowed-tools: 解析工具列表
  let allowedTools: string[] = []
  if (frontmatter['allowed-tools']) {
    if (Array.isArray(frontmatter['allowed-tools'])) {
      allowedTools = frontmatter['allowed-tools'].map(v => String(v))
    } else if (typeof frontmatter['allowed-tools'] === 'string') {
      allowedTools = frontmatter['allowed-tools'].split(',').map(v => v.trim())
    }
  }

  return {
    displayName: frontmatter.name != null ? String(frontmatter.name) : undefined,
    description,
    allowedTools,
    argumentHint: frontmatter['argument-hint'] != null ? String(frontmatter['argument-hint']) : undefined,
    argumentNames: parseArgumentNames(frontmatter.arguments),
    whenToUse: frontmatter.when_to_use != null ? String(frontmatter.when_to_use) : undefined,
    model: frontmatter.model != null ? String(frontmatter.model) : undefined,
    disableModelInvocation: parseBooleanFrontmatter(frontmatter['disable-model-invocation']),
    userInvocable: frontmatter['user-invocable'] === undefined ? true : parseBooleanFrontmatter(frontmatter['user-invocable']),
  }
}
```

- [ ] **Step 2: 创建 src/skills/index.ts**

```typescript
// src/skills/index.ts
export { loadSkillsFromSkillsDir } from './loadSkillsDir.js'
export { parseFrontmatter, parseSkillFrontmatterFields, type FrontmatterData, type ParsedMarkdown } from './frontmatter.js'
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit src/skills/frontmatter.ts src/skills/index.ts
```

预期: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/skills/frontmatter.ts src/skills/index.ts
git commit -m "feat(skills): add frontmatter parsing module"
```

---

## Task 3: 创建 skill 加载器

**Files:**
- Create: `src/skills/loadSkillsDir.ts`

**参考:** CC `src/skills/loadSkillsDir.ts:270-480`

- [ ] **Step 1: 创建 src/skills/loadSkillsDir.ts**

```typescript
// src/skills/loadSkillsDir.ts
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { PromptCommand, SkillContentBlock } from '../commands/types.js'
import { parseFrontmatter, parseSkillFrontmatterFields } from './frontmatter.js'

/** 配置来源 */
export type SkillSource = 'projectSettings' | 'userSettings' | 'bundled'

/**
 * 从 skills 目录加载所有 skill
 * @param basePath - .claude/skills 目录路径
 * @param source - 配置来源
 */
export async function loadSkillsFromSkillsDir(
  basePath: string,
  source: SkillSource,
): Promise<PromptCommand[]> {
  let entries: { name: string; isDirectory: () => boolean }[]

  try {
    entries = await readdir(basePath, { withFileTypes: true })
  } catch {
    // 目录不存在时返回空列表
    return []
  }

  const results = await Promise.all(
    entries.map(async (entry) => {
      // 只处理目录（skill-name/SKILL.md 格式）
      if (!entry.isDirectory()) {
        return null
      }

      const skillDirPath = join(basePath, entry.name)
      const skillFilePath = join(skillDirPath, 'SKILL.md')

      let content: string
      try {
        content = await readFile(skillFilePath, { encoding: 'utf-8' })
      } catch {
        // SKILL.md 不存在，跳过
        return null
      }

      const { frontmatter, content: markdownContent } = parseFrontmatter(content)
      const skillName = entry.name

      const parsed = parseSkillFrontmatterFields(
        frontmatter,
        markdownContent,
        skillName,
      )

      return createSkillCommand({
        skillName,
        markdownContent,
        baseDir: skillDirPath,
        source,
        ...parsed,
      })
    }),
  )

  return results.filter((r): r is PromptCommand => r !== null)
}

/**
 * 创建 skill command
 */
function createSkillCommand({
  skillName,
  displayName,
  description,
  markdownContent,
  allowedTools,
  argumentHint,
  argumentNames,
  whenToUse,
  model,
  disableModelInvocation,
  userInvocable,
  source,
  baseDir,
}: {
  skillName: string
  displayName: string | undefined
  description: string
  markdownContent: string
  allowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  model: string | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  source: SkillSource
  baseDir: string
}): PromptCommand {
  return {
    type: 'prompt',
    name: skillName,
    description,
    progressMessage: 'running',
    contentLength: markdownContent.length,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    argumentHint,
    whenToUse,
    model,
    disableModelInvocation,
    userInvocable,
    source,
    getPromptForCommand: async (args: string): Promise<SkillContentBlock[]> => {
      let finalContent = markdownContent

      // 简单的参数替换: $ARGUMENTS 替换为实际参数
      if (args) {
        finalContent = finalContent.replace(/\$ARGUMENTS/g, args)
      }

      return [{ type: 'text', text: finalContent }]
    },
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit src/skills/loadSkillsDir.ts
```

预期: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/skills/loadSkillsDir.ts
git commit -m "feat(skills): add skill loader for .claude/skills directory"
```

---

## Task 4: 创建 /skills 命令

**Files:**
- Create: `src/commands/skills/index.ts`

**参考:** `src/commands/exit/index.ts` 的 local 命令实现

- [ ] **Step 1: 创建 src/commands/skills/index.ts**

```typescript
// src/commands/skills/index.ts
import { loadSkillsFromSkillsDir } from '../../skills/loadSkillsDir.js'
import type { CommandResult } from '../types.js'

export default {
  name: 'skills',
  description: 'List all available skills',

  async call(): Promise<CommandResult> {
    const skills = await loadSkillsFromSkillsDir('.claude/skills', 'projectSettings')

    if (skills.length === 0) {
      return { type: 'text', value: 'No skills found.' }
    }

    const list = skills
      .map(s => `  /${s.name} - ${s.description}`)
      .join('\n')

    return { type: 'text', value: `Available skills:\n${list}` }
  },
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit src/commands/skills/index.ts
```

预期: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/commands/skills/index.ts
git commit -m "feat(commands): add /skills command to list available skills"
```

---

## Task 5: 修改 commands/index.ts 支持异步加载

**Files:**
- Modify: `src/commands/index.ts`

**参考:** 当前 `src/commands/index.ts` 实现

- [ ] **Step 1: 修改 src/commands/index.ts**

将 `getCommands()` 改为异步，合并 skills 到命令列表：

```typescript
// src/commands/index.ts
import type { Command, CommandContext, CommandResult, LocalJSXCommandOnDone } from "./types.js"
import { getCommandName, isCommandEnabled } from "./types.js"
import type React from "react"

export type { Command, CommandContext, CommandResult } from "./types.js"
export { getCommandName, isCommandEnabled } from "./types.js"

import exit from "./exit/index.js"
import clear from "./clear/index.js"
import tools from "./tools/index.js"
import help from "./help/index.js"
import system from "./system/index.js"
import skills from "./skills/index.js"
import { loadSkillsFromSkillsDir } from "../skills/loadSkillsDir.js"

/** 内置命令列表（不含 skills） */
const BUILTIN_COMMANDS: Command[] = [
  exit,
  clear,
  tools,
  help,
  system,
  skills,
]

/** 所有可用命令列表（异步加载） */
let commandsCache: Command[] | null = null

/**
 * 获取所有可用命令（包含内置命令 + skills）
 * 结果会被缓存
 */
export async function getCommands(): Promise<Command[]> {
  if (commandsCache) {
    return commandsCache
  }

  // 加载 skills
  const skillsList = await loadSkillsFromSkillsDir('.claude/skills', 'projectSettings')

  commandsCache = [...skillsList, ...BUILTIN_COMMANDS]
  return commandsCache
}

/**
 * 根据名称查找命令（支持别名）
 */
export async function findCommand(commandName: string): Promise<Command | undefined> {
  const commands = await getCommands()
  return commands.find((cmd) =>
    cmd.name === commandName ||
    cmd.aliases?.includes(commandName) ||
    getCommandName(cmd) === commandName,
  )
}

/**
 * 执行 slash command
 */
export async function executeCommand(
  input: string,
  context: CommandContext,
): Promise<ExecuteCommandResult> {
  const { parseSlashCommand } = await import("./parser.js")
  const parsed = parseSlashCommand(input)
  if (!parsed) {
    return { handled: false }
  }

  const { commandName, args } = parsed
  const command = await findCommand(commandName)
  if (!command || !isCommandEnabled(command)) {
    return { handled: false }
  }

  if (command.type === "local") {
    const module = await command.load()
    const result = await module.call(args, context)
    if (result.type === "text") {
      return { handled: true, textResult: result.value }
    }
    return { handled: true }
  }

  if (command.type === "local-jsx") {
    const module = await command.load()
    let doneCalled = false
    const onDone: LocalJSXCommandOnDone = (result) => {
      doneCalled = true
      if (result) {
        context.appendSystemMessage(result)
      }
    }
    const jsx = await module.call(onDone, context, args)
    if (!doneCalled) {
      return { handled: true, jsx, onDone }
    }
    return { handled: true }
  }

  // prompt 类型命令暂不支持直接执行（需要通过 SkillTool 调用）
  return { handled: false }
}

// 保留向后导出的 COMMANDS（静态版本，用于不需要异步的场景）
export { BUILTIN_COMMANDS as COMMANDS }
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit src/commands/index.ts
```

预期: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/commands/index.ts
git commit -m "feat(commands): refactor to support async skill loading"
```

---

## Task 6: 创建 SkillTool

**Files:**
- Create: `src/tools/skillTool.ts`
- Modify: `src/tools/index.ts` (导出)
- Modify: `src/commands/types.ts` (添加 SkillContentBlock 导出)

**参考:** CC `src/tools/SkillTool/SkillTool.ts` 和 `src/agent/tools/bash.ts` 的 tool 定义模式

- [ ] **Step 1: 创建 src/tools/skillTool.ts**

```typescript
// src/tools/skillTool.ts
import { Type, type Static } from "@sinclair/typebox"
import { defineAgentTool } from "../agent/define-agent-tool.js"
import type { AgentTool } from "../agent/types.js"
import type { Command, SkillContentBlock } from "../commands/types.js"
import { findCommand } from "../commands/index.js"

const SkillInputSchema = Type.Object({
  skill: Type.String({ description: "Skill name to execute" }),
  args: Type.Optional(Type.String({ description: "Arguments to pass to the skill" })),
})

const SkillOutputSchema = Type.Object({
  content: Type.String(),
  skillName: Type.String(),
})

type SkillInput = Static<typeof SkillInputSchema>
type SkillOutput = Static<typeof SkillOutputSchema>

/**
 * 创建 SkillTool
 * @param getCommands - 获取命令列表的函数
 */
export function createSkillTool(getCommands: () => Promise<Command[]>): AgentTool<typeof SkillInputSchema, SkillOutput> {
  return defineAgentTool({
    name: "Skill",
    label: "Skill",
    description: "Execute a skill by name. Skills are specialized prompts that help with specific tasks like brainstorming, code review, or planning.",
    parameters: SkillInputSchema,
    outputSchema: SkillOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    async execute(toolCallId, params, _context) {
      const commands = await getCommands()
      const command = commands.find(cmd => cmd.name === params.skill && cmd.type === 'prompt')

      if (!command) {
        return {
          content: `Skill '${params.skill}' not found. Available skills: ${commands.filter(c => c.type === 'prompt').map(c => c.name).join(', ')}`,
          skillName: params.skill,
        }
      }

      if (command.type !== 'prompt') {
        return {
          content: `'${params.skill}' is not a skill.`,
          skillName: params.skill,
        }
      }

      // 执行 skill 获取内容
      const contentBlocks = await command.getPromptForCommand(params.args ?? '')

      // 转换为文本
      const textContent = contentBlocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n\n')

      return {
        content: textContent,
        skillName: params.skill,
      }
    },

    formatResult(output) {
      return [{ type: "text", text: output.content }]
    },
  })
}
```

- [ ] **Step 2: 修改 src/tools/index.ts 添加导出**

```typescript
// src/tools/index.ts
export { createReadTool } from "./agent/tools/read/index.js"
export { createWriteTool } from "./agent/tools/write.js"
export { createEditTool } from "./agent/tools/edit.js"
export { createBashTool } from "./agent/tools/bash.js"
export { createGlobTool } from "./agent/tools/glob.js"
export { createSkillTool } from "./skillTool.js"
```

- [ ] **Step 3: 确保 SkillContentBlock 已导出**

确认 `src/commands/types.ts` 中已导出 `SkillContentBlock`（Task 1 已做）

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit src/tools/skillTool.ts src/tools/index.ts
```

预期: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/tools/skillTool.ts src/tools/index.ts
git commit -m "feat(tools): add SkillTool for model to invoke skills"
```

---

## Task 7: 修改 AgentSession 集成 skills 和 SkillTool

**Files:**
- Modify: `src/agent/session.ts`

**参考:** CC `src/tools/SkillTool/SkillTool.ts:331` 的集成方式

- [ ] **Step 1: 修改 src/agent/session.ts**

在 constructor 中加载 skills 并注册 SkillTool：

```typescript
// src/agent/session.ts
import type { Model, SystemPrompt } from "../core/ai/index.js"
import { asSystemPrompt } from "../core/ai/index.js"
import { logger } from "../utils/logger.js"
import { Agent } from "./agent.js"
import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "./types.js"
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGlobTool } from "./tools/index.js"
import { createSkillTool } from "../tools/skillTool.js"
import type { SystemPromptContext } from "./system-prompt/types.js"
import { buildCodingAgentSystemPrompt } from "./system-prompt/coding-agent.js"
import { getCommands } from "../commands/index.js"
```

修改 constructor 中的 tools 初始化：

```typescript
constructor(options: AgentSessionOptions) {
  this.cwd = options.cwd

  // 获取命令列表并注册 SkillTool
  const commandsPromise = getCommands().then(commands => {
    return commands.filter((cmd): cmd is AgentTool<any, any> => {
      // local 和 local-jsx 命令暂不注册为 tool
      // 只有 prompt 类型命令通过 SkillTool 调用
      return cmd.type === 'prompt'
    })
  })

  // 先用默认 tools 初始化 agent
  const defaultTools = [
    createReadTool(options.cwd),
    createWriteTool(options.cwd),
    createEditTool(options.cwd),
    createBashTool(options.cwd),
    createGlobTool(options.cwd),
  ]

  this.agent = new Agent({
    systemPrompt: async () => asSystemPrompt([""]),
    initialState: {
      model: options.model,
      thinkingLevel: options.thinkingLevel ?? "medium",
      tools: defaultTools,
    },
    getApiKey: () => options.apiKey,
  })

  // 异步加载 skills 并注册 SkillTool
  this.initializeSkills(commandsPromise)

  this.systemPromptBuilder = options.systemPrompt ?? buildCodingAgentSystemPrompt
  this.agent.subscribe((event) => this.handleAgentEvent(event))
}

/** 异步初始化 skills */
private async initializeSkills(commandsPromise: Promise<AgentTool<any, any>[]>): Promise<void> {
  try {
    const commands = await commandsPromise
    const skillTool = createSkillTool(async () => {
      const cmds = await getCommands()
      return cmds
    })
    this.agent.state.tools.push(skillTool)
    logger.debug('SkillTool registered', { toolName: skillTool.name })
  } catch (error) {
    logger.error('Failed to initialize skills', { error })
  }
}
```

**注意**: 上述修改需要适配器，因为我们不能直接修改 `this.agent.state.tools`。需要先查看 Agent 的状态管理方式。

- [ ] **Step 2: 检查 Agent 状态管理**

查看 `src/agent/agent.ts` 是否有方法来添加工具：

```typescript
// 查看 agent.state.tools 是否可写
```

如果 `agent.state.tools` 是只读的，需要找到其他方式注册 SkillTool。可能需要：
1. 在 Agent 构造时传入 SkillTool
2. 或者添加 `agent.registerTool()` 方法

- [ ] **Step 3: 根据 Step 2 的结果调整实现**

如果 Agent 不支持动态添加工具，则修改为在构造时传入：

```typescript
// 修改 AgentSession constructor
constructor(options: AgentSessionOptions) {
  this.cwd = options.cwd

  // 构造时就需要获取 commands
  const commands = await getCommands() // 需要改为同步或延迟

  const tools = options.tools ?? [
    createReadTool(options.cwd),
    createWriteTool(options.cwd),
    createEditTool(options.cwd),
    createBashTool(options.cwd),
    createGlobTool(options.cwd),
    createSkillTool(async () => getCommands()),
  ]
  // ...
}
```

**问题**: `getCommands()` 是异步的，但 constructor 不能是异步的。

**解决方案**: 使用懒加载模式，在第一次 `prompt()` 调用前初始化 tools。

- [ ] **Step 4: 实现懒加载方案**

```typescript
constructor(options: AgentSessionOptions) {
  this.cwd = options.cwd

  const defaultTools = [
    createReadTool(options.cwd),
    createWriteTool(options.cwd),
    createEditTool(options.cwd),
    createBashTool(options.cwd),
    createGlobTool(options.cwd),
  ]

  this.agent = new Agent({
    systemPrompt: async () => asSystemPrompt([""]),
    initialState: {
      model: options.model,
      thinkingLevel: options.thinkingLevel ?? "medium",
      tools: defaultTools,
    },
    getApiKey: () => options.apiKey,
  })

  this.systemPromptBuilder = options.systemPrompt ?? buildCodingAgentSystemPrompt
  this.agent.subscribe((event) => this.handleAgentEvent(event))

  // 异步初始化 SkillTool（不阻塞构造）
  this.initializeSkillTool()
}

private async initializeSkillTool(): Promise<void> {
  try {
    const skillTool = createSkillTool(async () => getCommands())
    // 直接修改 tools 数组（如果 agent.state.tools 可写）
    this.agent.state.tools.push(skillTool)
    logger.debug('SkillTool registered')
  } catch (error) {
    logger.error('Failed to initialize SkillTool', { error })
  }
}
```

**需要确认**: `AgentState.tools` 是否可写？

- [ ] **Step 5: 验证编译**

```bash
npx tsc --noEmit src/agent/session.ts
```

预期: 无错误或需要进一步调整

- [ ] **Step 6: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(session): integrate skill loading and SkillTool"
```

---

## Task 8: 测试验证

**Files:**
- 测试手动执行 `/skills` 命令
- 测试手动执行 `/brainstorming` 等 skill 命令

- [ ] **Step 1: 测试 /skills 命令**

在项目中运行测试，验证 `/skills` 能列出所有 skill：

```bash
# 启动 TUI 或 CLI，测试 /skills 命令
```

预期: 列出所有可用的 skill

- [ ] **Step 2: 测试 /brainstorming 命令**

```bash
# 测试 /brainstorming 触发 skill
```

预期: skill 内容被正确展开到对话中

- [ ] **Step 3: 测试 SkillTool**

验证模型可以通过 SkillTool 调用 skill：

```
User: Use SkillTool to invoke brainstorming
```

预期: 模型调用 SkillTool(skill="brainstorming") 并获取 skill 内容

---

## 成功标准

1. `/brainstorming` 能正常触发 skill
2. `/skills` 能查看所有可用 skill 列表
3. SkillTool(skill="brainstorming") 能正常调用 skill
4. skill 内容正确展开到当前对话
