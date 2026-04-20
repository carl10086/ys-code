# Skill Meta Message 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标:** 实现 skill 命令的 metaMessage 机制，让 skill 内容发送给 LLM 但不在 UI 显示

**架构:**
1. 新增 skill-tags.ts 定义 XML 常量和元数据生成函数
2. UIMessage 增加 isMeta 字段，MessageList 过滤 meta 消息
3. executeCommand 对 prompt 类型返回 metaMessages
4. app.tsx 处理 metaMessages，调用 session.prompt() 发送给 LLM

**技术栈:** TypeScript, React (Ink)

---

## 文件改动

| 文件 | 改动 |
|------|------|
| `src/commands/skill-tags.ts` | 新增：XML 标签常量和元数据生成函数 |
| `src/tui/types.ts` | 修改：UIMessage user 类型增加 isMeta 字段 |
| `src/tui/components/MessageList.tsx` | 修改：过滤 isMeta 消息 |
| `src/commands/index.ts` | 修改：ExecuteCommandResult 增加 metaMessages 字段 |
| `src/tui/app.tsx` | 修改：处理 metaMessages |

---

### Task 1: 创建 skill-tags.ts

**文件:**
- Create: `src/commands/skill-tags.ts`

- [ ] **Step 1: 创建文件**

```typescript
// src/commands/skill-tags.ts

/** XML 标签常量 - 用于 skill 命令的元数据格式 */
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

- [ ] **Step 2: 验证文件创建**

Run: `cat src/commands/skill-tags.ts`
Expected: 文件内容正确

- [ ] **Step 3: 提交**

---

### Task 2: UIMessage 类型增加 isMeta

**文件:**
- Modify: `src/tui/types.ts:7`

- [ ] **Step 1: 修改 UIMessage 类型**

将：
```typescript
export type UIMessage =
  | { type: "user"; text: string }
```

改为：
```typescript
export type UIMessage =
  | { type: "user"; text: string; isMeta?: boolean }
```

- [ ] **Step 2: 验证类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "^src/tui/types.ts" || echo "No errors"`
Expected: 无输出（无错误）

- [ ] **Step 3: 提交**

---

### Task 3: MessageList 过滤 isMeta 消息

**文件:**
- Modify: `src/tui/components/MessageList.tsx:68-70`

- [ ] **Step 1: 修改消息渲染逻辑**

找到（约68行）：
```typescript
{messages.map((message, index) => (
  <MessageItem key={index} message={message} />
))}
```

改为：
```typescript
{messages
  .filter(m => !(m.type === "user" && m.isMeta))
  .map((message, index) => (
    <MessageItem key={index} message={message} />
  ))}
```

- [ ] **Step 2: 验证类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "^src/tui/components/MessageList.tsx" || echo "No errors"`
Expected: 无输出（无错误）

- [ ] **Step 3: 提交**

---

### Task 4: ExecuteCommandResult 增加 metaMessages 字段

**文件:**
- Modify: `src/commands/index.ts:88-98`

- [ ] **Step 1: 修改 ExecuteCommandResult 接口**

在 `textResult?: string;` 后添加：
```typescript
/** meta 消息内容（skill 内容，isMeta=true）*/
metaMessages?: string[];
```

- [ ] **Step 2: 验证类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "^src/commands/index.ts" || echo "No errors"`
Expected: 无输出（无错误）

- [ ] **Step 3: 提交**

---

### Task 5: app.tsx 处理 metaMessages

**文件:**
- Modify: `src/tui/app.tsx:45-62`

- [ ] **Step 1: 修改 handleSubmit 函数**

找到当前 handleSubmit 函数（约45-62行）：
```typescript
const handleSubmit = async (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;

  logger.info("User message submitted", { length: trimmed.length });

  appendUserMessage(trimmed);

  if (isStreaming) {
    session.steer(trimmed);
  } else {
    try {
      await session.prompt(trimmed);
    } catch (err) {
      // 错误会通过 AgentSessionEvent 的 turn_end 体现
    }
  }
};
```

改为：
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
        for (const metaContent of result.metaMessages) {
          logger.debug("Sending meta message to LLM", { contentLength: metaContent.length });
          await session.prompt(metaContent);
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
    try {
      await session.prompt(trimmed);
    } catch (err) {
      // 错误会通过 AgentSessionEvent 的 turn_end 体现
    }
  }
};
```

- [ ] **Step 2: 验证类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "^src/tui/app.tsx" || echo "No errors"`
Expected: 无输出（无错误）

- [ ] **Step 3: 提交**

---

## 验证步骤

1. 启动 TUI 应用
2. 输入 `/brainstorming hello`（或任意存在的 skill）
3. 确认 UI 只显示 `/brainstorming hello`
4. 确认 LLM 收到了 skill 的完整内容（通过 AI 的回复判断）
5. 检查日志中是否有 `Sending meta message to LLM`

---

## 计划自查

1. **Spec coverage**: 设计文档的所有改动点已覆盖
2. **Placeholder scan**: 无 TODO/TBD
3. **Type consistency**: metaMessages 类型一致（string[]）
