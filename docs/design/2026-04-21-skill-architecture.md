# Skill 系统架构设计

> 创建时间: 2026-04-21
> 用途: 记录实现细节，供后续参考

---

## 1. 系统定位

Skill 是 ys-code Agent 系统中的**指令扩展机制**。通过 slash command（`/skill-name`）触发，将预设的 prompt 模板展开注入对话上下文，供 LLM 在当前 turn 内使用。

**与内置命令的区别：**

| 类型 | 触发方式 | 执行位置 | 内容可见性 |
|------|----------|----------|------------|
| Local 命令 | `/exit` `/clear` | 客户端本地 | LLM 不可见 |
| Skill（Prompt 命令） | `/brainstorming` | Tool 调用，服务端 | LLM 可见（通过 meta 消息） |

**在 Agent Loop 中的位置：**

```
用户输入 "/brainstorming xxx"
    ↓
executeCommand() 解析 slash command
    ↓
SkillTool.execute() 返回 newMessages
    ↓
tool-execution.ts 收集 newMessages
    ↓
context.pendingMessages 触发新一轮循环
    ↓
LLM 在同一 turn 内收到展开的 skill 内容
```

---

## 2. 模块职责边界

### `src/agent/tools/skill.ts` — SkillTool

**职责：** 将 skill 执行封装为 AgentTool，供 agent loop 调用。

**核心接口：**

```typescript
// 输入参数
{ skill: string; args?: string }

// 输出
{
  content: [];  // UI 显示用，空数组表示不显示
  details: { success: boolean; skillName: string };
  newMessages?: AgentMessage[];  // 关键：触发循环的消息
  contextModifier?: (messages: AgentMessage[]) => AgentMessage[];
}
```

**关键设计：**
- `newMessages` 携带 skill 展开内容，注入 `context.pendingMessages` 触发新一轮循环
- `content` 返回空数组——UI 不直接显示 skill 结果，而是让 LLM 消化后自行回复
- `contextModifier` 目前是占位实现（返回原消息不变），后续可限制 `allowedTools`

---

### `src/commands/index.ts` — 命令路由

**职责：** 统一入口，解析 slash command，分发到对应命令类型处理。

**核心函数：**

```typescript
executeCommand(input: string, context: CommandContext, skillsBasePath?: string): ExecuteCommandResult
```

**处理流程：**
1. `parseSlashCommand()` 解析 `/command args`
2. `findCommand()` 查找对应 Command
3. 按类型分发：
   - `local` → 懒加载模块，调用 `call(args, context)`
   - `local-jsx` → 懒加载模块，调用 `call(onDone, context, args)`
   - `prompt` → 调用 `getPromptForCommand(args)` 获取内容，返回 `metaMessages`

**返回结构：**

```typescript
{
  handled: boolean;
  textResult?: string;      // local 命令返回值
  jsx?: React.ReactNode;   // local-jsx 命令返回值
  metaMessages?: string[];  // skill 内容（isMeta=true）
  onDone?: LocalJSXCommandOnDone;
}
```

---

### `src/skills/loadSkillsDir.ts` — Skill 加载

**职责：** 从 `.claude/skills/` 目录批量加载 skill 文件，转换为 `PromptCommand`。

**加载流程：**

```
skills/
  brainstorming/
    SKILL.md    ← 包含 frontmatter + markdown 正文
  subagent-driven-development/
    SKILL.md
```

1. 读取 `SKILL.md` 全文
2. `parseFrontmatter()` 分离 frontmatter 和 markdown 正文
3. `parseSkillFrontmatterFields()` 提取字段（description、allowedTools、argumentHint 等）
4. `createSkillCommand()` 构建 `PromptCommand` 对象

**PromptCommand 核心字段：**

```typescript
{
  type: 'prompt';
  name: string;                    // skill 唯一标识
  description: string;            // 用于 help / skill listing
  progressMessage: string;        // 执行中提示
  contentLength: number;          // token 估算用
  allowedTools?: string[];        // 限制可用工具
  argumentHint?: string;          // 参数提示文本
  argNames?: string[];            // 参数名列表
  whenToUse?: string;            // 使用时机说明
  model?: string;                // 指定模型
  disableModelInvocation?: boolean;
  userInvocable?: boolean;       // 是否允许用户直接调用
  source: 'projectSettings' | 'userSettings' | 'bundled';
  getPromptForCommand(args: string): Promise<SkillContentBlock[]>;
}
```

---

### `src/skills/frontmatter.ts` — Frontmatter 解析

**职责：** 解析 YAML frontmatter，提取 skill 元信息。

**支持的 frontmatter 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 显示名称（覆盖目录名） |
| `description` | string | 描述信息 |
| `allowed-tools` | string \| string[] | 允许使用的工具列表 |
| `argument-hint` | string | 参数提示（如 `"<skill> <args>"`） |
| `arguments` | string \| string[] | 参数名列表 |
| `when_to_use` | string | 使用时机说明 |
| `model` | string | 指定使用的模型 |
| `user-invocable` | boolean | 是否可由用户直接调用 |
| `disable-model-invocation` | boolean | 是否禁用模型调用 |
| `context` | inline \| fork | 上下文模式（预留） |
| `agent` | string | 使用的 Agent 名称（预留） |

**Markdown 正文处理：**
- `$ARGUMENTS` 占位符会被替换为实际传入的参数

---

## 3. 数据流

### Skill 执行完整路径

```
用户输入: "/brainstorming 结合我们的代码"
    ↓
TUI handleSubmit()
    ↓
executeCommand() → 返回 { handled: true, metaMessages: [textContent] }
    ↓
TUI 构建消息数组:
  [
    { role: "user", content: ["/brainstorming"], isMeta: false },
    { role: "user", content: [textContent], isMeta: true }
  ]
    ↓
session.prompt(messages)  ← 数组形式，同一 turn 发送
    ↓
Agent.runPromptMessages()
    ↓
runAgentLoop()
    ↓
streamAssistantResponse() → LLM 收到 /brainstorming
    ↓
LLM 调用 SkillTool
    ↓
SkillTool.execute() → 返回 { newMessages: [metaUserMessage] }
    ↓
tool-execution.ts:
  currentContext.pendingMessages.push(...newMessages)
    ↓
runLoop 检测到 pendingMessages，继续循环
    ↓
LLM 在同一 turn 内收到 skill 展开内容
    ↓
生成最终回复
```

### 关键机制: context.pendingMessages

```
工具返回 newMessages
    ↓
加入 context.pendingMessages（而非直接加入 messages）
    ↓
当前 turn 结束后，runLoop 检查 pendingMessages
    ↓
pendingMessages 非空 → 清空并继续循环
    ↓
pendingMessages 为空 → 结束 turn
```

**为什么不用直接加入 messages？**

因为 tool 执行是串行的，加入 messages 后 LLM 会在同一轮看到 tool result 和 newMessages，导致格式混乱。用 `pendingMessages` 触发独立的新循环，LLM 按正常流程处理。

---

## 4. UI 过滤

`isMeta: true` 的消息对 LLM 可见，但 UI 层（MessageList）不显示。

**过滤点：** `src/tui/components/MessageList.tsx`（或对应组件）按 `isMeta` 过滤。

---

## 5. 待验证 / 遗留问题

1. **contextModifier 真实用途** — 目前是占位实现，`allowedTools` 限制还未生效
2. **followUpQueue 是否必要** — 有了 `context.pendingMessages`，`followUpQueue` 看起来是过度设计，但暂未移除
3. **多轮 skill 展开** — 如果一个 skill 返回的 newMessages 再次触发 skill 调用，循环是否能正确处理？

---

## 6. 相关文件索引

| 文件 | 职责 |
|------|------|
| `src/agent/tools/skill.ts` | SkillTool 定义与执行 |
| `src/commands/index.ts` | 命令路由与执行 |
| `src/commands/types.ts` | Command / PromptCommand 类型定义 |
| `src/commands/parser.ts` | Slash command 解析 |
| `src/skills/loadSkillsDir.ts` | Skill 批量加载 |
| `src/skills/frontmatter.ts` | Frontmatter 解析 |
| `src/tui/app.tsx` | TUI 层调用入口 |
| `src/agent/types.ts` | AgentContext（pendingMessages 定义处） |
| `src/agent/tool-execution.ts` | newMessages 收集与 pendingMessages 注入 |
| `src/agent/agent-loop.ts` | pendingMessages 循环触发检查 |
