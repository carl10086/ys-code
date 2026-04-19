# @file Attachment 系统设计文档

> 对齐 cc 的 `@...` 选择文件机制，在 ys-code 中实现最小可行的 `@file` attachment 系统。

---

## 背景与目标

当前 ys-code 的 attachment 系统只支持 `relevant_memories` 类型（CLAUDE.md 上下文注入）。cc 中用户可以通过 `@/path/to/file` 在输入中引用文件，系统会自动读取文件内容并作为 `type: "file"` 的 attachment 注入消息流，让模型"感觉"到文件已被读取过。

**目标**：实现最小可行的 `@file` attachment 系统，支持文本文件的 `@...` 引用，与现有 `relevant_memories` 机制共存。

---

## 核心机制（对齐 cc）

### 1. Attachment 类型扩展

在现有 `Attachment` 联合类型中新增 `file` 和 `directory`：

```typescript
/** 文件附件（@... 引用） */
export interface FileAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "file";
  /** 文件绝对路径 */
  filePath: string;
  /** 文件内容（当前仅支持 text 类型） */
  content: string;
  /** 相对路径（用于显示） */
  displayPath: string;
  /** 是否因大小限制被截断 */
  truncated?: boolean;
}

/** 目录附件（@... 引用目录） */
export interface DirectoryAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "directory";
  /** 目录绝对路径 */
  path: string;
  /** 目录内容（ls 结果） */
  content: string;
  /** 相对路径（用于显示） */
  displayPath: string;
}
```

### 2. normalizeAttachment 扩展

`normalizeAttachment` 新增 `file` 和 `directory` case，生成**模拟的 tool_use + tool_result** 文本，包装在 `<system-reminder>` 中：

- **`file`** → 模拟 FileReadTool 调用 + 结果：
  ```
  <system-reminder>
  Called the FileReadTool tool with the following input: {"file_path": "/abs/path"}

  Result of calling the FileReadTool tool:
  {"filePath": "/abs/path", "content": "...", "numLines": 100, "startLine": 1, "totalLines": 100}
  </system-reminder>
  ```

- **`directory`** → 模拟 BashTool(ls) 调用 + 结果：
  ```
  <system-reminder>
  Called the BashTool tool with the following input: {"command": "ls /abs/path"}

  Result of calling the BashTool tool:
  {"stdout": "file1.ts\nfile2.ts", "stderr": "", "interrupted": false}
  </system-reminder>
  ```

### 3. @... 解析与文件读取

#### 3.1 提取 `@...` 路径

```typescript
/** 从文本中提取 @... 提到的文件路径 */
export function extractAtMentionedFiles(content: string): string[];
```

支持：
- 普通路径：`@file.ts`、 `@src/utils/logger.ts`
- 带引号路径（支持空格）：`@"my file.ts"`
- 不支持行号范围（第一阶段简化）

#### 3.2 读取文件生成 Attachment

```typescript
/** 读取 @... 提到的文件，生成 FileAttachment */
export async function readAtMentionedFile(
  filePath: string,
  cwd: string,
): Promise<FileAttachment | DirectoryAttachment | null>;
```

逻辑：
1. 解析路径（支持相对路径，基于 cwd 解析为绝对路径）
2. 如果是目录 → 读取目录条目，生成 `DirectoryAttachment`
3. 如果是文件 → 读取文本内容，生成 `FileAttachment`
4. 限制：只读取文本文件，超过一定大小（如 200KB）返回 truncated 标记
5. 错误处理（文件不存在等）→ 返回 null（静默失败，不阻塞主流程）

### 4. 注入时机

`streamAssistantResponse` 在每轮请求前增加 `@...` 扫描步骤：

```typescript
// stream-assistant.ts
async function injectAtMentionAttachments(
  messages: AgentMessage[],
  cwd: string,
): Promise<AgentMessage[]> {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    result.push(msg);

    if (msg.role !== "user" || typeof msg.content !== "string") {
      continue;
    }

    const mentionedFiles = extractAtMentionedFiles(msg.content);
    if (mentionedFiles.length === 0) {
      continue;
    }

    const attachments = await Promise.all(
      mentionedFiles.map((fp) => readAtMentionedFile(fp, cwd)),
    );

    for (const attachment of attachments) {
      if (attachment) {
        result.push({
          role: "attachment",
          attachment,
          timestamp: Date.now(),
        });
      }
    }
  }

  return result;
}
```

调用位置：在 `streamAssistantResponse` 中，userContext 注入之后、`normalizeMessages` 之前：

```typescript
// streamAssistantResponse 流程
let messages = context.messages;

// 1. 注入 userContext（relevant_memories）
if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  const attachments = getUserContextAttachments(userContext);
  messages = [...attachments, ...messages];
}

// 2. 注入 @file attachment（新增）
messages = await injectAtMentionAttachments(messages, process.cwd());

// 3. normalize（attachment → UserMessage）
const normalizedMessages = normalizeMessages(messages);
```

### 5. 与 relevant_memories 共存

| 特性 | relevant_memories | @file attachment |
|------|-------------------|------------------|
| 类型 | `type: "relevant_memories"` | `type: "file"` / `type: "directory"` |
| 来源 | CLAUDE.md 自动聚合 | 用户输入中 `@...` 解析 |
| 生成时机 | `getUserContext()` | `injectAtMentionAttachments()` |
| 注入位置 | 消息流头部（prepend） | 对应 user message 之后 |
| normalize 结果 | `<system-reminder>` + 上下文提示 | `<system-reminder>` + 模拟 tool_use/tool_result |

两者都通过 `normalizeMessages` 统一处理，合并到相邻 user message 中。

---

## 数据流

```
用户输入: "检查 @src/utils/logger.ts 的日志逻辑"

        ↓

消息流: [UserMessage("检查 @src/utils/logger.ts 的日志逻辑")]

        ↓ injectAtMentionAttachments

消息流: [UserMessage("检查 @src/utils/logger.ts 的日志逻辑"),
         AttachmentMessage(file: {filePath, content, ...})]

        ↓ normalizeMessages

消息流: [UserMessage("检查 @src/utils/logger.ts 的日志逻辑\n" +
         "<system-reminder>\n" +
         "Called the FileReadTool tool...\n" +
         "Result of calling the FileReadTool tool...\n" +
         "</system-reminder>")]

        ↓ convertToLlm → streamSimple

LLM 收到包含文件内容的 user message
```

---

## 边界情况

1. **文件不存在** → `readAtMentionedFile` 返回 null，不生成 attachment（不阻塞）
2. **文件过大** → 读取前 N 行，标记 `truncated: true`，normalize 时附加提示
3. **二进制文件** → 不支持，返回 null（第一阶段）
4. **多个 `@...`** → 每个生成独立 AttachmentMessage，normalize 时合并到同一 user message
5. **@... 在消息中间** → 提取后不影响原始 user message 内容（`@...` 保留在文本中）

---

## 后续扩展（不在本阶段）

- 行号范围：`@file.ts#L10-20`
- 图片/PDF 支持
- `@agent-name` agent mention
- 目录条目数限制（当前 cc 限制 1000）
- 权限检查（读取敏感文件前确认）

---

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agent/attachments/types.ts` | 修改 | 扩展 Attachment 联合类型，新增 FileAttachment、DirectoryAttachment |
| `src/agent/attachments/normalize.ts` | 修改 | 新增 `file`、`directory` normalize case |
| `src/agent/attachments/at-mention.ts` | 新增 | `@...` 解析、文件读取、Attachment 生成 |
| `src/agent/stream-assistant.ts` | 修改 | 增加 `injectAtMentionAttachments` 调用 |
| `src/agent/attachments/at-mention.test.ts` | 新增 | 解析、读取、normalize 测试 |
