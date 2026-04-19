# AttachmentMessage 系统设计

## 背景

当前 `ys-code` 通过 `prependUserContext()` 将 CLAUDE.md 等内容以纯文本 `UserMessage` 的形式注入到消息列表最前面。这种方式缺乏结构化信息，无法区分"这是用户输入"和"这是系统注入的上下文"。

参考 `claude-code-haha`（cc）的实现，引入 `AttachmentMessage` 概念：一种带类型标签的结构化消息，在送给 LLM 之前会被 normalize 为普通 `UserMessage`，但 agent 内部保留结构化信息以便后续逻辑判断。

## 目标

1. **结构化**：agent 内部能区分不同来源的上下文（CLAUDE.md、plan、file 引用等）
2. **透明性**：LLM 看到的文本与现有行为完全一致
3. **可扩展性**：新增 attachment 类型时，只需添加类型定义和对应的 normalize 逻辑
4. **渐进实现**：第一阶段只实现 `relevant_memories`，验证通路后再添加其他类型

## 非目标

- 修改 `core/ai` 层的 `Message` 类型（保持纯净）
- 修改 LLM API 的调用格式（attachment 在 API 调用前已转为 UserMessage）
- 第一阶段实现 `file` / `already_read_file`（依赖 FileReadTool，尚未实现）

## 架构设计

### 分层边界

```
agent 层（扩展点）
  ├── AgentMessage = Message | AttachmentMessage
  ├── Attachment = RelevantMemoriesAttachment | ...（后续扩展）
  ├── normalizeMessages(): AgentMessage[] → Message[]
  └── getUserContextAttachments(): UserContext → AttachmentMessage[]

core/ai 层（保持纯净）
  ├── Message = UserMessage | AssistantMessage | ToolResultMessage
  └── streamSimple() 只接受 Message[]
```

### 核心类型

#### Attachment（可辨识联合体）

```typescript
// src/agent/attachments/types.ts

/** 附件基础接口 */
interface BaseAttachment {
  /** 附件类型 */
  type: string;
  /** 生成时间戳 */
  timestamp: number;
}

/** 相关记忆附件（CLAUDE.md 等） */
export interface RelevantMemoriesAttachment extends BaseAttachment {
  type: "relevant_memories";
  /** 上下文项列表 */
  entries: Array<{
    /** 上下文键名，如 "CLAUDE.md" */
    key: string;
    /** 上下文内容 */
    value: string;
  }>;
}

/** 附件联合体 —— 第一阶段只包含 relevant_memories */
export type Attachment = RelevantMemoriesAttachment;
```

#### AttachmentMessage

```typescript
// src/agent/attachments/types.ts

/** 附件消息 */
export interface AttachmentMessage {
  role: "attachment";
  /** 附件内容 */
  attachment: Attachment;
  /** 时间戳 */
  timestamp: number;
}
```

通过 declaration merging 扩展 `AgentMessage`：

```typescript
// src/agent/attachments/types.ts

declare module "../types.js" {
  interface CustomAgentMessages {
    attachment: AttachmentMessage;
  }
}
```

### Normalize 流程

`normalizeMessages()` 负责将 `AgentMessage[]` 中的 `AttachmentMessage` 转换为 `UserMessage[]`，并合并到相邻的 `UserMessage` 中。

```typescript
// src/agent/attachments/normalize.ts

/** 将单个 attachment 展开为 UserMessage[] */
function normalizeAttachment(attachment: Attachment): UserMessage[] {
  switch (attachment.type) {
    case "relevant_memories": {
      const content = [
        "<system-reminder>",
        "As you answer the user's questions, you can use the following context:",
        ...attachment.entries.map(e => `# ${e.key}\n${e.value}`),
        "",
        "IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
        "</system-reminder>",
        "",
      ].join("\n");
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    default:
      // 穷尽检查 —— 新增类型时必须添加 case
      const _exhaustive: never = attachment;
      return [];
  }
}

/** 将 AgentMessage[] 中的 attachment 展开并合并到相邻 user message */
export function normalizeMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role !== "attachment") {
      result.push(msg);
      continue;
    }

    const expanded = normalizeAttachment(msg.attachment);
    if (expanded.length === 0) continue;

    // 尝试合并到前一个 user message
    const last = result[result.length - 1];
    if (last && last.role === "user" && typeof last.content === "string") {
      const first = expanded[0];
      if (typeof first.content === "string") {
        last.content = last.content + "\n" + first.content;
        result.push(...expanded.slice(1));
        continue;
      }
    }

    // 无法合并，直接追加
    result.push(...expanded);
  }

  return result;
}
```

### 重构 user-context.ts

将 `prependUserContext()` 重构为基于 attachment 的实现：

```typescript
// src/agent/context/user-context.ts

/** 将 UserContext 转换为 AttachmentMessage[] */
export function getUserContextAttachments(context: UserContext): AttachmentMessage[] {
  const entries = Object.entries(context)
    .filter(([, value]) => value && value.trim() !== "")
    .map(([key, value]) => ({ key, value: value! }));

  if (entries.length === 0) return [];

  return [{
    role: "attachment",
    attachment: {
      type: "relevant_memories",
      entries,
      timestamp: Date.now(),
    },
    timestamp: Date.now(),
  }];
}

/** @deprecated 使用 getUserContextAttachments + normalizeMessages 替代 */
export function prependUserContext(messages: Message[], context: UserContext): Message[] {
  const attachments = getUserContextAttachments(context);
  const normalized = normalizeMessages(attachments as AgentMessage[]);
  return [...normalized, ...messages] as Message[];
}
```

### stream-assistant.ts 调用点修改

```typescript
// src/agent/stream-assistant.ts

import { getUserContext, getUserContextAttachments } from "./context/user-context.js";
import { normalizeMessages } from "./attachments/normalize.js";

// 在 streamAssistantResponse 中：
let messages = context.messages;
if (config.transformContext) {
  messages = await config.transformContext(messages, signal);
} else if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  const attachments = getUserContextAttachments(userContext);
  messages = [...attachments, ...messages];
}

// 在 convertToLlm 前 normalize
const normalizedMessages = normalizeMessages(messages);
const llmMessages = await config.convertToLlm(normalizedMessages);
```

## 文件改动清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/agent/attachments/types.ts` | Attachment 和 AttachmentMessage 类型定义 |
| `src/agent/attachments/normalize.ts` | normalizeAttachment + normalizeMessages |
| `src/agent/attachments/index.ts` | 统一导出 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/agent/types.ts` | 确保 `CustomAgentMessages` 接口可扩展（已有，无需改动） |
| `src/agent/context/user-context.ts` | 添加 `getUserContextAttachments()`，`prependUserContext()` 标记 deprecated |
| `src/agent/stream-assistant.ts` | 调用点改为先生成 attachment 再 normalize |

## 后续扩展路径

### 第二阶段：file / already_read_file

等 FileReadTool 实现后，添加：

```typescript
export interface FileAttachment extends BaseAttachment {
  type: "file";
  filePath: string;
  content: string;
  mimeType?: string;
}

export interface AlreadyReadFileAttachment extends BaseAttachment {
  type: "already_read_file";
  filePath: string;
}
```

`normalizeAttachment` 中：
- `file` → 生成 synthetic `tool_use` + `tool_result` message pair（复刻 cc 行为）
- `already_read_file` → 返回空数组（token 优化，内容已在上下文中）

### 第三阶段：plan_mode / plan_mode_exit

等 plan mode 功能实现后，添加对应 attachment 类型和 normalize 逻辑。

## 测试策略

1. **normalizeMessages**：
   - attachment 独立存在时正确展开为 UserMessage
   - attachment 前有 UserMessage 时正确合并
   - 多个 attachment 连续存在时按序处理
   - LLM 看到的文本与现有 `prependUserContext` 输出完全一致

2. **getUserContextAttachments**：
   - 空 context 返回空数组
   - 非空 context 生成正确结构的 AttachmentMessage

3. **端到端**：
   - `streamAssistantResponse` 中 attachment → normalize → convertToLlm 链路完整

## 兼容性

- `prependUserContext` 保留为 deprecated 包装函数，现有调用点无需立即修改
- `AgentMessage` 通过 declaration merging 扩展，不影响现有 `Message` 类型的使用
- `core/ai` 层完全无感知，normalize 在 agent 层完成
