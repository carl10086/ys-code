# Pi-mono Compact 系统技术设计文档

## 1. 概述

Pi-mono 的 compact 系统与 Claude Code 类似，也是通过将长对话压缩为结构化摘要来管理上下文。但两者在架构和实现上有显著差异。

### 1.1 核心目标

- **上下文空间管理**：当 context tokens 超过阈值时触发压缩
- **树形会话支持**：支持分支摘要，当切换分支时保留上下文
- **文件操作追踪**：累积追踪会话中读取和修改的文件

### 1.2 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pi-mono Compact System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────────────────┐│
│  │ Compaction        │         │ Branch Summarization         ││
│  │ (自动/手动压缩)    │         │ (分支切换时保留上下文)         ││
│  └──────────────────┘         └──────────────────────────────┘│
│           │                               │                    │
│           └───────────────┬───────────────┘                    │
│                           ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              Shared Utilities (utils.ts)                 │ │
│  │  - File Operation Tracking                                 │ │
│  │  - Message Serialization                                   │ │
│  │  - Token Estimation                                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心文件结构

```
packages/coding-agent/src/core/compaction/
├── compaction.ts           # 自动压缩逻辑 (~823 行)
├── branch-summarization.ts # 分支摘要 (~355 行)
├── utils.ts                # 共享工具 (~170 行)
└── index.ts               # 导出入口
```

---

## 3. 压缩触发机制

### 3.1 阈值计算

```typescript
// compaction.ts:115-125
export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;      // 预留 tokens（默认 16384）
  keepRecentTokens: number;     // 保留的 recent tokens（默认 20000）
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

// compaction.ts:219-222
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}
```

### 3.2 配置来源

- `~/.pi/agent/settings.json` — 全局配置
- `<project-dir>/.pi/settings.json` — 项目级配置

---

## 4. 核心压缩流程 (compaction.ts)

### 4.1 Token 估算

```typescript
// compaction.ts:232-290
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user": {
      // 字符串或数组内容，按 text block 累加
      if (typeof content === "string") {
        chars = content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
        }
      }
      return Math.ceil(chars / 4);  // 保守估算（高估）
    }
    case "assistant": {
      // 累加 text, thinking, toolCall
      for (const block of assistant.content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "thinking") chars += block.thinking.length;
        else if (block.type === "toolCall") {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "toolResult": {
      // 估算 image 为 1200 tokens
      if (block.type === "image") chars += 4800;
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    // ...
  }
}
```

### 4.2 切割点检测

```typescript
// compaction.ts:299-337
function findValidCutPoints(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number
): number[] {
  const cutPoints: number[] = [];

  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];

    // 有效切割点类型
    if (entry.type === "message") {
      const role = entry.message.role;
      switch (role) {
        case "bashExecution":
        case "custom":
        case "branchSummary":
        case "compactionSummary":
        case "user":
        case "assistant":
          cutPoints.push(i);
          break;
        case "toolResult":
          break;  // Never cut at tool results!
      }
    }
  }

  return cutPoints;
}
```

### 4.3 切割点查找算法

```typescript
// compaction.ts:386-448
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  // 从最新消息向后累加，直到达到 keepRecentTokens
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];  // 默认：保留到第一条消息

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;

    const messageTokens = estimateTokens(entry.message);
    accumulatedTokens += messageTokens;

    // 检查是否超过预算
    if (accumulatedTokens >= keepRecentTokens) {
      // 找到最近的合法切割点
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }

  // 扫描直到遇到消息头部或 compaction 边界
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    if (prevEntry.type === "compaction") break;
    if (prevEntry.type === "message") break;
    cutIndex--;  // 包含非消息条目（bash, settings 等）
  }

  // 确定是否切割了 turn
  const cutEntry = entries[cutIndex];
  const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}
```

### 4.4 压缩执行流程

```typescript
// compaction.ts:612-687
export function prepareCompaction(
  pathEntries: SessionEntry[],
  settings: CompactionSettings
): CompactionPreparation | undefined {
  // 1. 检查是否已有最近的 compaction
  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  // 2. 获取前一个摘要（用于迭代更新）
  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    // 从前一个 compaction 的 firstKeptEntryId 开始
    const firstKeptEntryIndex = pathEntries.findIndex(
      entry => entry.id === prevCompaction.firstKeptEntryId
    );
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }

  // 3. 计算切割点
  const cutPoint = findCutPoint(pathEntries, boundaryStart, pathEntries.length, settings.keepRecentTokens);

  // 4. 收集待摘要的消息
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) messagesToSummarize.push(msg);
  }

  // 5. 如果切割了 turn，收集 turn prefix
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }

  // 6. 提取文件操作
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex);

  return {
    firstKeptEntryId: pathEntries[cutPoint.firstKeptEntryIndex].id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  };
}
```

---

## 5. 摘要生成 (compaction.ts)

### 5.1 摘要提示词

```typescript
// compaction.ts:454-525
const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize.
Create a structured context checkpoint summary.

Use this EXACT format:

## Goal
[What is the user trying to accomplish?]

## Constraints & Preferences
- [Any constraints or requirements]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
[Issues, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list]

## Critical Context
[Any data or references needed]`;

const UPDATE_SUMMARIZATION_PROMPT = `Update existing summary with new information.
RULES:
- PRESERVE all existing information
- ADD new progress, decisions, and context
- UPDATE Progress section
- PRESERVE exact file paths, function names, error messages`;
```

### 5.2 摘要生成函数

```typescript
// compaction.ts:530-588
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model<any>,
  reserveTokens: number,
  apiKey: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);

  // 1. 选择提示词（初始或更新）
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }

  // 2. 序列化对话为文本
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);

  // 3. 构建提示词
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  // 4. 调用 LLM
  const response = await completeSimple(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    { maxTokens, signal, apiKey, headers }
  );

  return response.content.filter(...).join("\n");
}
```

---

## 6. 消息序列化 (utils.ts)

### 6.1 对话序列化

```typescript
// utils.ts:109-162
export function serializeConversation(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // 提取文本内容
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content.filter(...).map(c => c.text).join("");
      parts.push(`[User]: ${content}`);
    } else if (msg.role === "assistant") {
      // 分离 text, thinking, toolCall
      for (const block of msg.content) {
        if (block.type === "text") parts.push(`[Assistant]: ${block.text}`);
        else if (block.type === "thinking") parts.push(`[Assistant thinking]: ${block.thinking}`);
        else if (block.type === "toolCall") parts.push(`[Assistant tool calls]: ${block.name}(...)`);
      }
    } else if (msg.role === "toolResult") {
      // 截断到 2000 字符
      const content = ...;
      parts.push(`[Tool result]: ${truncateForSummary(content, 2000)}`);
    }
  }

  return parts.join("\n\n");
}
```

### 6.2 文件操作追踪

```typescript
// utils.ts:29-56
export function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
  if (message.role !== "assistant") return;

  for (const block of message.content) {
    if (block.type !== "toolCall") continue;

    const path = block.arguments.path;
    if (!path) continue;

    switch (block.name) {
      case "read": fileOps.read.add(path); break;
      case "write": fileOps.written.add(path); break;
      case "edit": fileOps.edited.add(path); break;
    }
  }
}
```

---

## 7. 分支摘要 (branch-summarization.ts)

### 7.1 触发时机

当使用 `/tree` 导航到不同分支时触发。

### 7.2 工作流程

```typescript
// branch-summarization.ts:98-136
export function collectEntriesForBranchSummary(
  session: ReadonlySessionManager,
  oldLeafId: string | null,
  targetId: string,
): CollectEntriesResult {
  // 1. 找到共同祖先
  const oldPath = new Set(session.getBranch(oldLeafId).map(e => e.id));
  const targetPath = session.getBranch(targetId);

  let commonAncestorId: string | null = null;
  for (let i = targetPath.length - 1; i >= 0; i--) {
    if (oldPath.has(targetPath[i].id)) {
      commonAncestorId = targetPath[i].id;
      break;
    }
  }

  // 2. 从旧叶子收集到共同祖先的条目
  const entries: SessionEntry[] = [];
  let current: string | null = oldLeafId;

  while (current && current !== commonAncestorId) {
    const entry = session.getEntry(current);
    if (!entry) break;
    entries.push(entry);
    current = entry.parentId;
  }

  entries.reverse();  // 转为时间顺序
  return { entries, commonAncestorId };
}
```

### 7.3 累积文件追踪

```typescript
// branch-summarization.ts:185-237
export function prepareBranchEntries(
  entries: SessionEntry[],
  tokenBudget: number = 0
): BranchPreparation {
  // 第一遍：从所有条目收集文件操作（即使超出 token 预算）
  // 确保嵌套分支摘要的累积追踪
  for (const entry of entries) {
    if (entry.type === "branch_summary" && !entry.fromHook && entry.details) {
      const details = entry.details as BranchSummaryDetails;
      // 从之前摘要添加文件
      for (const f of details.readFiles) fileOps.read.add(f);
      for (const f of details.modifiedFiles) fileOps.edited.add(f);
    }
  }

  // 第二遍：从最新到最旧，添加消息直到 token 预算
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const message = getMessageFromEntry(entry);
    if (!message) continue;

    extractFileOpsFromMessage(message, fileOps);
    const tokens = estimateTokens(message);

    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      // 如果是摘要条目，尝试容纳（作为重要上下文）
      if (entry.type === "compaction" || entry.type === "branch_summary") {
        if (totalTokens < tokenBudget * 0.9) {
          messages.unshift(message);
          totalTokens += tokens;
        }
      }
      break;
    }

    messages.unshift(message);
    totalTokens += tokens;
  }
}
```

---

## 8. 数据结构

### 8.1 CompactionEntry

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  fromHook?: boolean;  // 扩展提供时为 true
  details?: T;         // 实现特定数据
}

interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

### 8.2 BranchSummaryEntry

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  fromId: string;       // 导航来源的条目
  fromHook?: boolean;
  details?: T;
}
```

---

## 9. 扩展机制

### 9.1 session_before_compact

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  // preparation.messagesToSummarize - 待摘要消息
  // preparation.turnPrefixMessages - 切割 turn 的前缀（如果有）
  // preparation.previousSummary - 前一个压缩摘要
  // preparation.fileOps - 提取的文件操作
  // preparation.tokensBefore - 压缩前 context tokens
  // preparation.firstKeptEntryId - 保留消息起始位置

  // 取消：
  return { cancel: true };

  // 自定义摘要：
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { readFiles: [], modifiedFiles: [] },
    }
  };
});
```

---

## 10. 与 Claude Code 对比

| 特性 | Claude Code | Pi-mono |
|------|-------------|---------|
| **触发方式** | 自动（阈值计算） + 手动 `/compact` | 自动 + 手动 `/compact` |
| **摘要格式** | XML 标签 + 9 部分结构 | Markdown 结构 |
| **树形支持** | 无 | Branch Summary |
| **文件追踪** | 压缩后重新注入文件附件 | 累积追踪到 details |
| **扩展机制** | PreCompact/PostCompact Hooks | session_before_compact |
| **缓存策略** | Forked Agent 复用 prompt cache | 直接调用 LLM |
| **微压缩** | Time-based MC + Cached MC | 无 |
| **Session Memory** | 支持（实验性） | 无 |

### 10.1 摘要格式对比

**Claude Code**：
```xml
<analysis>
[思考过程]
</analysis>
<summary>
1. Primary Request and Intent:
   [详细描述]
2. Key Technical Concepts:
   - [概念1]
   ...
</summary>
```

**Pi-mono**：
```markdown
## Goal
[用户目标]

## Constraints & Preferences
- [约束]

## Progress
### Done
- [x] [已完成]

### In Progress
- [ ] [进行中]

## Key Decisions
- **[决策]**: [理由]
```

### 10.2 架构差异

| 方面 | Claude Code | Pi-mono |
|------|-------------|---------|
| **消息模型** | 扁平消息列表 | 树形 Session Entries |
| **压缩单元** | 所有历史消息 | 从上一次压缩边界开始 |
| **工具限制** | 压缩时禁用所有工具 | 压缩时禁用所有工具 |
| **迭代摘要** | 每次压缩独立 | 支持迭代更新前一个摘要 |

---

## 11. 文件清单

```
packages/coding-agent/src/core/compaction/
├── compaction.ts           # 自动压缩逻辑 (~823 行)
│   ├── estimateTokens()
│   ├── findValidCutPoints()
│   ├── findCutPoint()
│   ├── prepareCompaction()
│   ├── generateSummary()
│   ├── compact()
│   └── generateTurnPrefixSummary()
│
├── branch-summarization.ts # 分支摘要 (~355 行)
│   ├── collectEntriesForBranchSummary()
│   ├── prepareBranchEntries()
│   └── generateBranchSummary()
│
├── utils.ts                # 共享工具 (~170 行)
│   ├── extractFileOpsFromMessage()
│   ├── computeFileLists()
│   ├── formatFileOperations()
│   ├── serializeConversation()
│   └── SUMMARIZATION_SYSTEM_PROMPT
│
└── index.ts               # 导出入口
```

---

## 12. 配置

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 启用自动压缩 |
| `reserveTokens` | `16384` | 为 LLM 响应预留 tokens |
| `keepRecentTokens` | `20000` | 保留的 recent tokens |
