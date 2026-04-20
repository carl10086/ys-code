# SkillTool 消息注入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SkillTool 返回的 skill 内容能作为 meta user 消息注入到 LLM 上下文中

**Architecture:**
- 扩展 AgentToolResult 支持 newMessages 和 contextModifier
- SkillTool.execute() 返回 metaUserMessage 注入对话
- tool-execution.ts 处理 newMessages 注入

**Tech Stack:** TypeScript, TypeBox

---

## 文件结构

```
src/
├── agent/
│   ├── types.ts                          # 修改: AgentToolResult 添加字段
│   ├── tool-execution.ts                 # 修改: 处理 newMessages 注入
│   ├── session.ts                        # 修改: 更新 import 路径
│   └── tools/
│       ├── index.ts                      # 修改: 导出 createSkillTool
│       └── skill.ts                      # 创建: 新的 SkillTool 实现
└── core/ai/
    └── types.ts                          # 修改: UserMessage 添加 isMeta
```

---

## Task 1: 扩展 AgentToolResult 类型

**Files:**
- Modify: `src/agent/types.ts:44-47`

- [ ] **Step 1: 读取当前 AgentToolResult 定义**

确认当前 `AgentToolResult` 接口位置（应在第 44-47 行）

- [ ] **Step 2: 添加 newMessages 和 contextModifier 字段**

```typescript
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  /** 注入到消息列表的新消息（UI 隐藏，LLM 可见） */
  newMessages?: AgentMessage[];
  /** 上下文修改器 */
  contextModifier?: (messages: AgentMessage[]) => AgentMessage[];
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit src/agent/types.ts
```

预期: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/agent/types.ts
git commit -m "feat(agent): add newMessages and contextModifier to AgentToolResult"
```

---

## Task 2: 扩展 UserMessage 类型

**Files:**
- Modify: `src/core/ai/types.ts:128-133`

- [ ] **Step 1: 读取当前 UserMessage 定义**

确认当前 `UserMessage` 接口位置（应在第 128-133 行）

- [ ] **Step 2: 添加 isMeta 字段**

```typescript
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 是否为 meta 消息（UI 隐藏，LLM 可见） */
  isMeta?: boolean;
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit src/core/ai/types.ts
```

预期: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/core/ai/types.ts
git commit -m "feat(core): add isMeta to UserMessage"
```

---

## Task 3: 修改 tool-execution.ts 处理 newMessages

**Files:**
- Modify: `src/agent/tool-execution.ts`

**关键修改点:**
1. `executePreparedToolCall()` 返回值增加 `newMessages` 字段
2. `executeToolCallsSequential()` 和 `executeToolCallsParallel()` 注入 newMessages

- [ ] **Step 1: 修改 executePreparedToolCall 返回类型**

找到 `executePreparedToolCall` 函数（约第 127 行），修改返回类型：

```typescript
// 原来
Promise<{ output: unknown; isError: boolean }>

// 改为
Promise<{ output: unknown; isError: boolean; newMessages?: AgentMessage[] }>
```

- [ ] **Step 2: 在 executePreparedToolCall 中提取 newMessages**

在 return 语句前添加：

```typescript
// 提取 newMessages
const newMessages = (output as AgentToolResult<unknown>)?.newMessages;
return { output, isError: false, newMessages };
```

- [ ] **Step 3: 修改 executeToolCallsSequential 注入 newMessages**

在第 215 行 `executePreparedToolCall` 调用后，添加：

```typescript
// 注入 newMessages 到 messages 列表
if (executed.newMessages && executed.newMessages.length > 0) {
  for (const msg of executed.newMessages) {
    currentContext.messages.push(msg);
  }
  logger.debug("Injected newMessages from tool", { count: executed.newMessages.length });
}
```

- [ ] **Step 4: 同样修改 executeToolCallsParallel**

在第 263 行 `executePreparedToolCall` 返回结果处理后添加同样的 newMessages 注入逻辑

- [ ] **Step 5: 添加 AgentMessage import**

确认文件顶部 import 了 `AgentMessage`：

```typescript
import type {
  AgentContext,
  AgentEvent,
  AgentEventSink,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  ToolUseContext,
} from "./types.js";
```

- [ ] **Step 6: 验证编译**

```bash
npx tsc --noEmit src/agent/tool-execution.ts
```

预期: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/agent/tool-execution.ts
git commit -m "feat(agent): handle newMessages injection in tool execution"
```

---

## Task 4: 创建新的 SkillTool

**Files:**
- Create: `src/agent/tools/skill.ts`

- [ ] **Step 1: 创建 src/agent/tools/skill.ts**

```typescript
// src/agent/tools/skill.ts
import { Type, type Static } from "@sinclair/typebox";
import type { UserMessage } from "../../core/ai/index.js";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool, AgentToolResult, AgentMessage } from "../types.js";
import type { Command, PromptCommand } from "../../commands/types.js";

const SkillInputSchema = Type.Object({
  skill: Type.String({ description: "Skill name to execute" }),
  args: Type.Optional(Type.String({ description: "Arguments to pass to the skill" })),
});

const SkillOutputSchema = Type.Object({
  success: Type.Boolean(),
  skillName: Type.String(),
});

type SkillInput = Static<typeof SkillInputSchema>;
type SkillOutput = Static<typeof SkillOutputSchema>;

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

    async execute(toolCallId, params, _context): Promise<AgentToolResult<SkillOutput>> {
      const commands = await getCommands();
      const command = commands.find(cmd => cmd.name === params.skill && cmd.type === 'prompt') as PromptCommand | undefined;

      if (!command) {
        return {
          content: [{ type: "text", text: `Skill '${params.skill}' not found. Available skills: ${commands.filter(c => c.type === 'prompt').map(c => c.name).join(', ')}` }],
          details: { success: false, skillName: params.skill },
        };
      }

      // 执行 skill 获取内容
      const contentBlocks = await command.getPromptForCommand(params.args ?? '');

      // 转换为文本
      const textContent = contentBlocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');

      // 创建 meta user 消息（UI 隐藏，LLM 可见）
      const metaUserMessage: UserMessage = {
        role: "user",
        content: textContent,
        timestamp: Date.now(),
        isMeta: true,
      };

      // contextModifier 注入 allowedTools 限制（当前为占位实现）
      const modifier = (messages: AgentMessage[]): AgentMessage[] => {
        // allowedTools 限制后续实现
        return messages;
      };

      return {
        content: [],
        details: { success: true, skillName: params.skill },
        newMessages: [metaUserMessage as AgentMessage],
        contextModifier: modifier,
      };
    },

    formatResult(output) {
      return [{ type: "text", text: `Skill ${output.skillName} executed` }];
    },
  });
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit src/agent/tools/skill.ts
```

预期: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/skill.ts
git commit -m "feat(skill): create SkillTool with message injection"
```

---

## Task 5: 更新 exports

**Files:**
- Modify: `src/agent/tools/index.ts`

- [ ] **Step 1: 添加 createSkillTool 导出**

```typescript
export { createReadTool } from "./read/index.js";
export { createWriteTool } from "./write.js";
export { createEditTool } from "./edit.js";
export { createBashTool } from "./bash.js";
export { createGlobTool } from "./glob.js";
export { createSkillTool } from "./skill.js";
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit src/agent/tools/index.ts
```

预期: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/index.ts
git commit -m "feat(tools): export createSkillTool"
```

---

## Task 6: 更新 session import 路径

**Files:**
- Modify: `src/agent/session.ts`

- [ ] **Step 1: 修改 import 路径**

找到第 8 行：

```typescript
// 原来
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGlobTool, createSkillTool } from "../tools/index.js";

// 改为
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGlobTool, createSkillTool } from "./tools/index.js";
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit src/agent/session.ts
```

预期: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(session): update SkillTool import path to agent/tools"
```

---

## Task 7: 清理旧的 skillTool 文件

**Files:**
- Delete: `src/tools/skillTool.ts`

- [ ] **Step 1: 删除旧文件**

```bash
rm src/tools/skillTool.ts
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

预期: 无错误（除了可能的已有测试错误）

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: remove old skillTool from tools directory"
```

---

## 成功标准

1. `AgentToolResult` 支持 `newMessages` 和 `contextModifier` 字段
2. `UserMessage` 支持 `isMeta` 字段
3. `tool-execution.ts` 能正确注入 `newMessages` 到 `currentContext.messages`
4. `SkillTool` 返回 `{ content: [], details, newMessages: [metaUserMessage], contextModifier }`
5. `session.ts` 能正确导入并注册 `SkillTool`
