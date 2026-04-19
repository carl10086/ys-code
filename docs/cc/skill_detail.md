# Skill 机制详解

## 先记 4 句话

1. 你在 `/` 菜单里能看到的东西，内部统一叫 `Command`。
2. `skill` 在运行时不会保留“文件”形态，而是会变成一个 `Command`。
3. 更准确地说，`skill` 会变成 `type = 'prompt'` 的 `Command`。
4. 模型真正执行 skill 时，不是直接读 `SKILL.md`，而是通过 `SkillTool` 去调用这个 `Command`。

如果只记一句：

**skill = 用 `SKILL.md` 定义出来的 prompt command。**

---

## 0. 先粗懂 `Command`

不要先想类型系统，先想用户视角：

**你输入 `/` 能找到的每一项，内部都是一个 `Command`。**

它只是一个统一壳子，用来回答这些问题：

- 它叫什么
- 描述是什么
- 用户能不能直接 `/xxx`
- 模型能不能调用
- 这个东西到底怎么执行

源码定义在：

```175:206:src/types/command.ts
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

最粗的分类只有 3 个：

- `local`：本地直接执行，比如 `/clear`
- `local-jsx`：本地 UI 命令，比如 `/help`
- `prompt`：先展开成 prompt，再交给模型继续做，比如 `/commit`

所以 `type = 'prompt'` 的意思非常朴素：

**这个 command 不是本地直接跑，而是先生成一段 prompt。**

---

## 1. skill 文件长什么样

当前主格式是：

```text
.claude/skills/<skill-name>/SKILL.md
```

也就是：

- 一个目录对应一个 skill
- 目录里必须有 `SKILL.md`

加载入口在 `src/skills/loadSkillsDir.ts`：

```403:410:src/skills/loadSkillsDir.ts
/**
 * Loads skills from a /skills/ directory path.
 * Only supports directory format: skill-name/SKILL.md
 */
async function loadSkillsFromSkillsDir(
  basePath: string,
  source: SettingSource,
): Promise<SkillWithPath[]> {
```

---

## 2. `SKILL.md` 怎么变成 `Command`

主线其实很短：

```text
读 SKILL.md
-> 解析 frontmatter + markdown 正文
-> createSkillCommand(...)
-> 得到一个 type = 'prompt' 的 Command
```

先拆 frontmatter：

```447:458:src/skills/loadSkillsDir.ts
const { frontmatter, content: markdownContent } = parseFrontmatter(
  content,
  skillFilePath,
)

const parsed = parseSkillFrontmatterFields(
  frontmatter,
  markdownContent,
  skillName,
)
```

再组装成 command：

```180:189:src/skills/loadSkillsDir.ts
export function createSkillCommand({
  ...
}): Command {
  return {
    type: 'prompt',
    name: skillName,
    description,
    ...
```

这里可以只盯几个最关键字段：

- `name`
- `description`
- `whenToUse`
- `allowedTools`
- `context`
- `agent`
- `getPromptForCommand(...)`

到这一步开始，系统眼里它已经不是“一个 markdown 文件”，而是“一个可执行 command”。

---

## 3. skill 怎么进入命令系统

skill 不走单独 registry，而是并入统一的 command 集合。

入口在 `src/commands.ts`：

```460:468:src/commands.ts
return [
  ...bundledSkills,
  ...builtinPluginSkills,
  ...skillDirCommands,
  ...workflowCommands,
  ...pluginCommands,
  ...pluginSkills,
  ...COMMANDS(),
]
```

也就是说，下面这些东西最后都会被统一看成 `Command`：

- 内建命令
- skill 目录里的 skill
- plugin skills
- workflow commands

这也是为什么前面要先懂 `Command`。

---

## 4. skill 怎么进模型上下文

skill 不是一加载就把整份 `SKILL.md` 塞给模型。

先给模型看的通常只是摘要：

- skill 名
- description
- whenToUse

对应的是 skill listing：

```2661:2750:src/utils/attachments.ts
async function getSkillListingAttachments(
  toolUseContext: ToolUseContext,
): Promise<Attachment[]> {
  ...
  const localCommands = await getSkillToolCommands(cwd)
  const content = formatCommandsWithinBudget(newSkills, contextWindowTokens)
  return [
    {
      type: 'skill_listing',
      content,
      skillCount: newSkills.length,
      isInitial,
    },
  ]
}
```

如果开了 skill search，还会有 discovery 提示，告诉模型：

- 哪些 skill 和当前任务相关
- 需要完整说明的话，请调用 `SkillTool`

所以它是两阶段：

```text
先给摘要
-> 真正需要时再加载完整 skill 内容
```

---

## 5. SkillTool 在这里干什么

`SkillTool` 不是用来“定义 skill”的，而是用来“执行 skill”的。

它做的事很简单：

```text
接收 skill 名
-> 找到对应 Command
-> 校验/鉴权
-> 执行这个 Command
```

定义在：

```331:345:src/tools/SkillTool/SkillTool.ts
export const SkillTool: Tool<InputSchema, Output, Progress> = buildTool({
  name: SKILL_TOOL_NAME,
  ...
  description: async ({ skill }) => `Execute skill: ${skill}`,
  prompt: async () => getPrompt(getProjectRoot()),
```

它的输入也很朴素：

```291:297:src/tools/SkillTool/SkillTool.ts
z.object({
  skill: z.string(),
  args: z.string().optional(),
})
```

所以一句话：

**`SkillTool` 是 skill 的执行桥，不是 skill 的存储层。**

---

## 6. skill 真正执行时分两种

### `inline`

默认情况。

意思是：

- 把 skill 编译后的 prompt 内容并入当前会话
- 在当前消息链里继续跑

真正展开 skill 内容的关键点是 `getPromptForCommand(...)`：

```344:398:src/skills/loadSkillsDir.ts
async getPromptForCommand(args, toolUseContext) {
  let finalContent = baseDir
    ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
    : markdownContent
  ...
  return [{ type: 'text', text: finalContent }]
}
```

### `fork`

如果 frontmatter 里指定 `context: fork`，就不在主会话展开，而是走 sub-agent。

对应 `SkillTool` 里的 `executeForkedSkill(...)`：

```118:130:src/tools/SkillTool/SkillTool.ts
async function executeForkedSkill(
  command: Command & { type: 'prompt' },
  commandName: string,
  args: string | undefined,
  context: ToolUseContext,
  ...
): Promise<ToolResult<Output>> {
```

所以最粗暴的理解就是：

- `inline`：把 skill 当成本轮 prompt 的一部分
- `fork`：把 skill 当成一个子 agent 任务

---

## 一张图看完

```text
SKILL.md
-> loadSkillsDir.ts 读取并解析
-> createSkillCommand(...)
-> 变成 type = 'prompt' 的 Command
-> commands.ts 把它注册进命令系统
-> attachments/messages 只先给模型看 skill 摘要
-> 模型调用 SkillTool(skill=...)
-> SkillTool 找到对应 Command
-> inline 或 fork 执行
```

---

## 最后只记这 3 句

1. `Command` 就是 `/` 菜单项背后的统一内部对象。
2. `skill` 只是其中一种来源，最终会变成 `type = 'prompt'` 的 `Command`。
3. 模型不是直接执行 `SKILL.md`，而是通过 `SkillTool` 去执行这个 command。
