# Skill Meta Message 设计方案

## 背景问题

当前 ys-code 中，skill 命令（如 `/brainstorming hello`）的处理方式与 CC 源码不一致：

**当前行为（ys-code）**：
1. 用户输入 `/brainstorming hello`
2. `executeCommand()` 直接执行 skill，返回 textResult
3. textResult 通过 `appendSystemMessage()` 显示为系统消息
4. 发送给 LLM 的只有用户输入的那条普通消息

**期望行为（CC 方式）**：
1. 用户输入 `/brainstorming hello`
2. 生成两条 UserMessage：
   - 第1条（isMeta=false）：显示 `<command-message>brainstorming</command-message><command-name>/brainstorming</command-name><command-args>hello</command-args>`
   - 第2条（isMeta=true）：skill 内容，LLM 可见但 UI 隐藏
3. 第1条由 UI 渲染显示 `/brainstorming hello`
4. 第2条发送给 LLM 作为上下文，但不显示在 UI

## 解决方案

### 架构改动

```
用户输入 "/brainstorming hello"
         ↓
executeCommand() 返回 ExecuteCommandResult
         ↓
┌────────────────────────────────────┐
│ ExecuteCommandResult 改造          │
│ - handled: boolean                 │
│ - metaMessages?: string[]  // 新增 │
└────────────────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ app.tsx handleSubmit 改造          │
│ - 显示第1条消息（正常显示）         │
│ - 调用 session.prompt(第2条)        │
└────────────────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ MessageList 改造                   │
│ - 过滤 isMeta=true 的消息不显示     │
└────────────────────────────────────┘
```

## 改动范围

### 1. 新增文件

| 文件 | 作用 |
|------|------|
| `src/commands/skill-tags.ts` | XML 标签常量和元数据生成函数 |

### 2. 修改文件

| 文件 | 改动 |
|------|------|
| `src/tui/types.ts` | UIMessage 增加 `isMeta?: boolean` |
| `src/tui/components/MessageList.tsx` | 过滤 `isMeta: true` 的消息 |
| `src/commands/index.ts` | `ExecuteCommandResult` 增加 `metaMessages` 字段 |
| `src/tui/app.tsx` | 处理 `metaMessages`，调用 `session.prompt()` |

## 详细设计

### 1. skill-tags.ts（新增）

```typescript
// src/commands/skill-tags.ts

/** XML 标签常量 */
export const COMMAND_MESSAGE_TAG = 'command-message';
export const COMMAND_NAME_TAG = 'command-name';
export const COMMAND_ARGS_TAG = 'command-args';

/**
 * 生成 skill 命令的元数据字符串
 * @param commandName 命令名称（不含 /）
 * @param args 命令参数
 * @returns 格式化的 XML 字符串
 */
export function formatSkillMetadata(commandName: string, args?: string): string {
  return [
    `<${COMMAND_MESSAGE_TAG}>${commandName}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>/${commandName}</${COMMAND_NAME_TAG}>`,
    args ? `<${COMMAND_ARGS_TAG}>${args}</${COMMAND_ARGS_TAG}>` : null,
  ].filter(Boolean).join('\n');
}
```

### 2. tui/types.ts（修改）

UIMessage 的 user 类型增加 isMeta 字段：

```typescript
export type UIMessage =
  | { type: "user"; text: string; isMeta?: boolean }
  | { type: "system"; text: string }
  | { type: "assistant_start" }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; toolName: string; args: unknown }
  | { type: "tool_end"; toolName: string; isError: boolean; summary: string; timeMs: number }
  | {
      type: "assistant_end";
      tokens: number;
      cost: number;
      timeMs: number;
    };
```

### 3. MessageList.tsx（修改）

过滤 isMeta 消息：

```typescript
// 在 map 之前添加 filter
{messages
  .filter(m => !(m.type === "user" && m.isMeta))
  .map((message, index) => (
    <MessageItem key={index} message={message} />
  ))}
```

### 4. commands/index.ts（修改）

ExecuteCommandResult 增加 metaMessages 字段：

```typescript
export interface ExecuteCommandResult {
  /** 是否匹配并执行了命令 */
  handled: boolean;
  /** 若为 local-jsx 命令，返回待渲染的 JSX */
  jsx?: React.ReactNode;
  /** 若为 local 命令，返回文本结果 */
  textResult?: string;
  /** 完成回调（local-jsx 命令使用） */
  onDone?: LocalJSXCommandOnDone;
  /** meta 消息内容（skill 内容，isMeta=true）*/
  metaMessages?: string[];
}
```

executeCommand 函数中，prompt 类型命令返回 metaMessages：

```typescript
// prompt 类型命令：获取 skill 内容作为 meta 消息返回
if (command.type === "prompt") {
  try {
    const contentBlocks = await command.getPromptForCommand(args);
    const textContent = contentBlocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n\n');
    return { handled: true, metaMessages: [textContent] };
  } catch {
    return { handled: false };
  }
}
```

### 5. app.tsx（修改）

```typescript
const handleSubmit = async (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;

  logger.info("User message submitted", { length: trimmed.length });

  // 检查是否是 slash 命令
  if (trimmed.startsWith("/")) {
    const result = await executeCommand(trimmed, {
      session,
      appendUserMessage,
      appendSystemMessage,
      resetSession,
    });

    if (result.handled) {
      // 显示用户输入
      appendUserMessage(trimmed);

      // 处理 meta 消息
      if (result.metaMessages && result.metaMessages.length > 0) {
        // 第1条 meta 消息作为用户消息发送给 LLM（不显示在 UI）
        for (const metaContent of result.metaMessages) {
          session.prompt(metaContent);
        }
      }

      if (result.textResult) {
        appendSystemMessage(result.textResult);
      }
      return;
    }
  }

  // 普通用户消息
  appendUserMessage(trimmed);
  if (isStreaming) {
    session.steer(trimmed);
  } else {
    await session.prompt(trimmed);
  }
};
```

## 数据流

1. 用户输入 `/brainstorming hello`
2. `handleSubmit` 调用 `executeCommand()`
3. `executeCommand` 找到对应 prompt 命令，调用 `getPromptForCommand()` 获取 skill 内容
4. 返回 `{ handled: true, metaMessages: [skillContent] }`
5. `handleSubmit` 调用 `appendUserMessage(trimmed)` 显示 `/brainstorming hello`
6. `handleSubmit` 调用 `session.prompt(skillContent)` 发送 skill 内容给 LLM
7. MessageList 渲染时过滤掉 `isMeta: true` 的消息

## 日志设计

关键路径添加 DEBUG/INFO 级别日志：

| 位置 | 级别 | 日志内容 |
|------|------|----------|
| `executeCommand` 找到 prompt 命令 | DEBUG | `Skill command found: ${commandName}` |
| `executeCommand` 调用 `getPromptForCommand` | DEBUG | `Fetching skill content: ${commandName}` |
| `executeCommand` 返回 metaMessages | DEBUG | `Skill metaMessages generated: ${metaMessages.length} blocks` |
| `handleSubmit` 发送 meta 消息 | DEBUG | `Sending meta message to LLM, content length: ${content.length}` |
| `handleSubmit` 处理完成 | INFO | `Slash command executed: ${commandName}` |

## 验证方式

1. 启动 TUI，输入 `/brainstorming hello`
2. 确认 UI 显示 `/brainstorming hello`（第1条消息）
3. 确认 LLM 能看到 skill 的完整内容
4. 确认 skill 内容不会在 UI 中显示（被过滤）
5. 检查日志输出确认 meta 消息发送

## 后续扩展

- 支持 skill hooks（cc 中 `registerSkillHooks`）
- 支持 skill 权限信息（cc 中 `command_permissions`）
- 支持 skill 文件变化热更新
