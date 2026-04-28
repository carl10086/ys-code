# Command 执行流程对齐设计

## Objective

对齐 ys-code 的 PromptCommand 执行流程与 cc（claude-code），使 slash command（`/cmd args`）和 SkillTool 调用生成的消息结构、参数替换能力、用户体验与 cc 保持一致。

## Background

当前 ys-code 已实现的 command 基础设施：
- 四级命令加载：builtin → skills → userSettings (`~/.claude/commands/`) → projectSettings (`.claude/commands/`)
- `PromptCommand` 类型定义（`type`, `name`, `source`, `getPromptForCommand`, `allowedTools`, `model`, `userInvocable` 等字段）
- 基础的 `$ARGUMENTS` 替换（跳过 fenced code blocks）
- `isMeta` 消息标记（模型可见、用户隐藏）
- `dispatchCommandResult` 统一分发命令结果到 UI 和会话

与 cc 的差距见 `docs/ys-powers/specs/2026-04-28-command-execution-gap-analysis.md`（由 `/review_cc` 生成）。

## Scope

### In Scope（本次实现）

| 优先级 | 功能点 | 说明 |
|--------|--------|------|
| P0 | PromptCommand 消息组装格式 | metadata 消息 + isMeta main message，模仿 cc 的 `getMessagesForPromptSlashCommand` |
| P0 | userInvocable 检查 | 阻止用户直接调用 `userInvocable: false` 的 skill |
| P1 | 具名参数替换 | `$1`, `$2`, `$ARGUMENTS[0]`, `$ARGUMENTS[1]` + frontmatter `arguments` 定义的具名参数 |
| P1 | appendIfNoPlaceholder | 无占位符时自动追加 `ARGUMENTS: ${args}` |
| P1 | 命令级模型覆盖 | frontmatter `model` 字段传递给 `AgentSession`，当前 turn 使用该模型 |

### Out of Scope（明确排除）

- `allowedTools` 权限传递（AgentSession 暂无工具权限机制）
- Shell 内联执行（`!`command`` / ` ```! ... ``` `）
- `effort` 控制
- `hooks` 注册
- 条件 Skill（`paths` frontmatter）
- 动态 Skill 发现
- 跨目录文件去重
- 命名空间支持（`subdir:command-name`）

## Design

### 1. 消息组装流程

#### 1.1 cc 的消息结构

cc 的 `processSlashCommand` 为 prompt 命令生成以下消息序列：

```
1. metadata message (visible)
   内容: <command-message>name</command-message>\n<command-name>/name</command-name>\n<command-args>args</command-args>
   → UI 渲染为 "/name args" 的输入记录

2. main message (isMeta)
   内容: skill 展开后的完整内容（getPromptForCommand 结果）
   → 模型可见，用户不可见

3. attachment messages (isMeta, optional)
   内容: 从 skill 内容中提取的 @-mention 附件
   → 当前 ys-code 的 @-mention 系统较简单，暂不实现

4. command_permissions message (isMeta)
   内容: { type: 'command_permissions', allowedTools, model }
   → 当前无权限机制，排除
```

#### 1.2 ys-code 的对齐方案

ys-code 生成**两类消息**：

```
1. user visible message
   role: "user"
   content: "/name args"
   → 显示在 UI 消息列表中

2. meta message
   role: "user"
   content: skill 展开后的内容
   isMeta: true
   → 模型可见，UI 隐藏
```

**与 cc 的差异**：
- cc 的 metadata 消息也是模型可见的（用于让模型知道执行了哪个命令），ys-code 的 visible message 同时被模型和用户看到
- cc 的 main message 是 `ContentBlockParam[]` 格式，ys-code 使用简单字符串（不绑定 Anthropic SDK）
- cc 有 `command_permissions` 消息，ys-code 没有（本次不实现）

#### 1.3 实现位置

修改 `src/tui/command-utils.ts` 的 `dispatchCommandResult`：

```typescript
export function dispatchCommandResult(
  result: ExecuteCommandResult,
  text: string,
  session: AgentSession,
  appendUserMessage: (text: string) => void,
  appendSystemMessage: (text: string) => void,
): boolean {
  if (!result.handled) return false;

  // P0: userInvocable 检查
  // 由 executeCommand 在调用 getPromptForCommand 前完成
  // 若 userInvocable === false，返回 handled=true + metaMessages=["此命令只能由模型调用..."]

  // 显示用户输入
  appendUserMessage(text);

  if (result.metaMessages && result.metaMessages.length > 0) {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
      ...result.metaMessages.map((metaContent): AgentMessage => ({
        role: "user",
        content: [{ type: "text", text: metaContent }],
        timestamp: Date.now(),
        isMeta: true,
      })),
    ];
    session.prompt(messages);
  } else {
    session.prompt(text);
  }

  if (result.textResult) {
    appendSystemMessage(result.textResult);
  }

  return true;
}
```

**修改 `ExecuteCommandResult`**：

```typescript
export interface ExecuteCommandResult {
  handled: boolean;
  jsx?: React.ReactNode;
  textResult?: string;
  metaMessages?: string[];
  onDone?: LocalJSXCommandOnDone;
  // P1: 命令级模型覆盖
  model?: string; // 若指定，当前 turn 使用该模型
}
```

### 2. userInvocable 检查

#### 2.1 实现位置

`src/commands/index.ts` 的 `executeCommand` 函数。

#### 2.2 逻辑

```typescript
if (command.type === 'prompt') {
  if (command.userInvocable === false) {
    return {
      handled: true,
      metaMessages: [`This skill can only be invoked by the model, not directly by users. Ask the model to use the "${command.name}" skill for you.`],
    };
  }
  // ... 继续执行 getPromptForCommand
}
```

**注意**：此检查仅在用户直接输入 `/cmd` 时生效。模型通过 `SkillTool` 调用时不受此限制（由工具执行逻辑控制）。

### 3. 参数替换增强

#### 3.1 当前实现

`src/commands/loadCommandsDir.ts`：

```typescript
function replaceArgumentsOutsideCodeBlocks(content: string, args: string): string {
  const lines = content.split("\n");
  let inCodeBlock = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (inCodeBlock) return line;
      return line.replace(/\$ARGUMENTS/g, args);
    })
    .join("\n");
}
```

#### 3.2 目标实现

新建 `src/utils/argumentSubstitution.ts`，迁移并增强参数替换逻辑：

```typescript
export function parseArguments(args: string): string[] {
  if (!args || !args.trim()) return [];
  // 使用简单空格分割（cc 使用 shell-quote，ys-code 暂保持简单）
  return args.split(/\s+/).filter(Boolean);
}

export function parseArgumentNames(
  argumentNames: string | string[] | undefined,
): string[] {
  if (!argumentNames) return [];
  const isValidName = (name: string): boolean =>
    typeof name === 'string' && name.trim() !== '' && !/^\d+$/.test(name);
  if (Array.isArray(argumentNames)) {
    return argumentNames.filter(isValidName);
  }
  if (typeof argumentNames === 'string') {
    return argumentNames.split(/\s+/).filter(isValidName);
  }
  return [];
}

export function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder = true,
  argumentNames: string[] = [],
): string {
  if (args === undefined || args === null) return content;

  const parsedArgs = parseArguments(args);
  const originalContent = content;

  // 具名参数替换（$foo, $bar）
  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i];
    if (!name) continue;
    content = content.replace(
      new RegExp(`\\$${name}(?![\\[\\w])`, 'g'),
      parsedArgs[i] ?? '',
    );
  }

  // 索引参数替换（$ARGUMENTS[0], $ARGUMENTS[1]）
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    return parsedArgs[index] ?? '';
  });

  // 简写索引参数（$0, $1）
  content = content.replace(/\$(\d+)(?!\w)/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    return parsedArgs[index] ?? '';
  });

  // $ARGUMENTS 替换为完整参数字符串
  content = content.replaceAll('$ARGUMENTS', args);

  // 若无占位符且 appendIfNoPlaceholder，自动追加
  if (content === originalContent && appendIfNoPlaceholder && args) {
    content = content + `\n\nARGUMENTS: ${args}`;
  }

  return content;
}
```

#### 3.3 集成到 PromptCommand

修改 `createPromptCommand`：

```typescript
getPromptForCommand: async (args: string): Promise<SkillContentBlock[]> => {
  let finalContent = markdownContent;

  if (args) {
    finalContent = substituteArguments(
      finalContent,
      args,
      true, // appendIfNoPlaceholder
      argumentNames,
    );
  }

  return [{ type: "text", text: finalContent }];
},
```

**注意**：`substituteArguments` 不跳过 fenced code blocks。cc 也不跳过。若需要保留当前行为（跳过 code blocks），在 `createPromptCommand` 中包装：

```typescript
function substituteArgumentsOutsideCodeBlocks(
  content: string,
  args: string,
  argumentNames: string[],
): string {
  const lines = content.split("\n");
  let inCodeBlock = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (inCodeBlock) return line;
      return substituteArguments(line, args, false, argumentNames);
    })
    .join("\n");
}
```

### 4. 命令级模型覆盖

#### 4.1 实现位置

`src/tui/command-utils.ts` 的 `dispatchCommandResult`。

#### 4.2 逻辑

```typescript
if (result.metaMessages && result.metaMessages.length > 0) {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
    ...result.metaMessages.map((metaContent): AgentMessage => ({
      role: "user",
      content: [{ type: "text", text: metaContent }],
      timestamp: Date.now(),
      isMeta: true,
    })),
  ];
  // P1: 命令级模型覆盖
  if (result.model) {
    session.prompt(messages, { model: result.model });
  } else {
    session.prompt(messages);
  }
}
```

**修改 `AgentSession.prompt` 签名**：

```typescript
interface PromptOptions {
  model?: string; // 覆盖当前 turn 的模型
}

async prompt(input: string | AgentMessage[], options?: PromptOptions): Promise<void>;
```

**实现细节**：
- `AgentSession` 内部维护当前模型引用
- `prompt` 时若传入 `options.model`，临时切换到该模型，turn 结束后恢复默认模型
- 模型名称通过 `getModel()` 解析（复用现有逻辑）

### 5. SkillTool 调用同步

`src/agent/tools/skill.ts` 的 `SkillTool` 也需要同步消息生成逻辑：

```typescript
async execute(_toolCallId, params, _context) {
  const commands = await getCommands();
  const command = commands.find(
    cmd => cmd.name === params.skill && cmd.type === 'prompt'
  ) as PromptCommand | undefined;

  if (!command) {
    return {
      content: [],
      details: { success: false, skillName: params.skill },
    };
  }

  const contentBlocks = await command.getPromptForCommand(params.args ?? '');
  const textContent = contentBlocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n\n');

  const metaUserMessage: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: textContent }],
    timestamp: Date.now(),
    isMeta: true,
  };

  // P1: 传递模型覆盖
  const contextModifier = (messages: AgentMessage[]): AgentMessage[] => {
    // 未来可在此限制 allowedTools
    return messages;
  };

  return {
    content: [],
    details: { success: true, skillName: params.skill },
    newMessages: [metaUserMessage],
    contextModifier,
    // P1: 传递模型覆盖信息
    ...(command.model ? { modelOverride: command.model } : {}),
  };
}
```

## Testing Strategy

### 单元测试

1. **`src/utils/argumentSubstitution.test.ts`**
   - `parseArguments`: 空格分割、空字符串、undefined
   - `parseArgumentNames`: 数组输入、字符串输入、过滤数字
   - `substituteArguments`: $ARGUMENTS、$0/$1、$ARGUMENTS[0]、具名参数、无占位符追加、边界情况

2. **`src/commands/loadCommandsDir.test.ts`**（更新）
   - 验证 `createPromptCommand` 使用 `substituteArguments`
   - 验证具名参数正确传递

3. **`src/commands/index.test.ts`**（更新）
   - `userInvocable: false` 的 prompt 命令返回阻止消息
   - `userInvocable: true/undefined` 正常执行

4. **`src/tui/command-utils.test.ts`**（更新）
   - 验证消息组装顺序（visible + isMeta）
   - 验证 `model` 字段传递给 `session.prompt`

5. **`src/agent/tools/skill.test.ts`**（更新或新建）
   - 验证 SkillTool 返回的消息包含 `isMeta: true`
   - 验证 `modelOverride` 传递

### 集成测试

1. 端到端：输入 `/spec hello world`，验证 UI 显示 "/spec hello world"，模型收到 skill 内容 + ARGUMENTS 追加
2. 端到端：输入 `/spec`（无参数），验证无 ARGUMENTS 追加（因为 args 为空字符串）
3. 端到端：输入 `/model-only-skill`（userInvocable: false），验证 UI 显示阻止消息

## Project Structure

```
src/
  utils/
    argumentSubstitution.ts          # 新增：参数替换工具
    argumentSubstitution.test.ts     # 新增：参数替换测试
  commands/
    loadCommandsDir.ts               # 修改：集成 substituteArguments
    index.ts                         # 修改：userInvocable 检查
  tui/
    command-utils.ts                 # 修改：消息组装 + 模型覆盖
    command-utils.test.ts            # 更新：测试消息组装和模型覆盖
  agent/
    tools/
      skill.ts                       # 修改：同步消息生成逻辑
    session.ts                       # 修改：prompt 支持 options.model
```

## Boundaries

### Always Do
- 保持向后兼容：现有 `dispatchCommandResult` 和 `executeCommand` 调用方不受影响
- 所有修改遵循现有代码风格
- 每个功能点独立测试

### Ask First About
- 是否需要支持 effort 控制（需要修改 Agent 的 token 预算逻辑）
- 是否需要支持 shell 内联执行（安全影响较大）
- 是否需要支持 `allowedTools` 权限机制（需要 Agent 工具过滤重构）

### Never Do
- 本次不引入 Anthropic SDK 依赖（保持消息格式为简单字符串）
- 本次不修改附件/@-mention 系统
- 本次不添加缓存或 memoization 机制

## References

- cc `getMessagesForPromptSlashCommand`: `refer/claude-code-haha/src/utils/processUserInput/processSlashCommand.tsx:827-919`
- cc `substituteArguments`: `refer/claude-code-haha/src/utils/argumentSubstitution.ts`
- cc `userInvocable` 检查: `refer/claude-code-haha/src/utils/processUserInput/processSlashCommand.tsx:535-548`
