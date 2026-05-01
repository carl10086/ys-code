# Spec: Compact Command 手动上下文压缩

## Objective

本规格定义 `ys-code` 中手动 `/compact` command 的完整闭环设计。目标是对齐 Claude Code 的核心 compact 语义：用户触发本地命令后，系统先压缩当前会话上下文，再用 `compact_boundary + compact summary + restored attachments + command records` 接管后续模型上下文。

目标用户是使用 `ys-code` TUI 进行长会话编码任务的开发者。当历史消息、工具结果和附件逐渐增大时，用户可以手动执行 `/compact [instructions]`，释放上下文空间，同时保留继续工作的关键语义和精确材料。

本期明确不实现：

- `auto compact`
- `cached microcompact` / `cache_edits`
- `reactive compact`
- `session memory compact`

本期必须实现：

- 手动 `/compact [instructions]`
- 本地 content-clearing `microcompact`
- Claude Code 风格 compact prompt
- 使用当前会话模型生成 summary
- compact 成功后替换 active messages
- compact 失败或取消时不修改 active messages
- compact 后恢复必要 attachments，并为当前缺失状态源预留扩展点

成功意味着：`/compact` 是一个真正的本地上下文管理命令，而不是普通 prompt command；它不会把 `/compact` 再发送给主模型。

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- TUI: Ink + React
- AI provider abstraction: `src/core/ai/*`
- Agent/session runtime: `src/agent/*`, `src/session/*`
- Command system: `src/commands/*`
- Test framework: `bun test`

当前实现应复用已有依赖，不为 compact command 新增第三方依赖。

## Commands

开发与验证命令：

```bash
bun run src/main.ts
bun run src/tui/index.tsx
bun test
bun run typecheck
```

目标用户命令：

```bash
/compact
/compact 只关注代码修改，忽略闲聊
```

`/compact [instructions]` 中的可选参数只影响 compact summary prompt 的 `Additional Instructions`，不影响 microcompact、attachment restore 或 post-compact message ordering。

## Project Structure

建议新增或调整以下模块：

```text
src/commands/compact/
  index.ts        # 注册 /compact command
  compact.ts      # command 执行入口，调用 AgentSession.compact()

src/commands/types.ts
  # 扩展 CommandResult / ExecuteCommandResult，支持 compact 专用结果

src/commands/index.ts
  # 将 compact 加入 BUILTIN_COMMANDS

src/tui/command-utils.ts
  # 对 compact result 做 shouldQuery=false 风格处理，不调用 session.prompt()

src/agent/session.ts
  # 暴露 compact() 和 replaceMessages() 或等价封装

src/session/compact/
  index.ts          # compactConversation() 编排入口
  prompt.ts         # compact prompt、formatCompactSummary()
  microcompact.ts   # content-clearing microcompact
  attachments.ts    # post-compact attachment restore
  messages.ts       # boundary / summary / ordering helpers
  types.ts          # CompactionResult / metadata 类型

src/session/compact.test.ts 或 src/session/compact/*.test.ts
  # prompt、microcompact、messages、attachments、integration 测试
```

现有 `src/session/compact.ts` 已有早期 `CompactTrigger` 和简化 boundary 逻辑。实现时应迁移或重构为目录化 compact service，避免旧的“取前几条消息拼接摘要”继续作为真实 compact 行为。

## Architecture

### High-Level Flow

```text
用户输入 /compact [instructions]
  ↓
commands/compact 作为 local command 拦截
  ↓
compact command 调用 AgentSession.compact({ instructions, commandText })
  ↓
AgentSession 读取当前 active messages
  ↓
microcompact 先清理旧 toolResult 大内容
  ↓
compact service 用当前会话模型生成 summary
  ↓
compact service 生成 CompactionResult:
    compact_boundary
    compact summary user meta message
    restored attachments
    command records
    metrics
  ↓
AgentSession.replaceMessages(postCompactMessages)
  ↓
TUI 显示简短 Compacted 提示
  ↓
本轮 shouldQuery=false，不再请求主模型
```

### Module Responsibilities

`commands/compact` 只负责命令入口、参数传递和用户反馈，不直接拼装 compact 后 messages。

`AgentSession.compact()` 负责读取当前会话状态、调用 compact service、在成功后替换 active messages，并保证失败时原消息不变。

`session/compact` 负责 compact 业务逻辑：筛选当前有效上下文、执行 microcompact、生成 summary、恢复 attachments、构造 boundary 和 post-compact messages。

`tui/command-utils.ts` 负责识别 compact command result，并阻止当前命令走普通 `session.prompt(text)` 路径。

## Data Model

### CompactionResult

建议定义：

```ts
export interface CompactionResult {
  boundaryMessage: AgentMessage;
  summaryMessage: AgentMessage;
  messagesToKeep: AgentMessage[];
  attachments: AgentMessage[];
  displayText: string;
  metrics: {
    preCompactTokens: number;
    postCompactTokens?: number;
    microcompactTokensSaved: number;
    clearedToolCallIds: string[];
  };
}
```

### Compact Boundary

`compact_boundary` 是系统结构标记，不是普通 LLM 消息。建议通过 declaration merging 扩展 `AgentMessage`：

```ts
type CompactBoundaryMessage = {
  role: "compact_boundary";
  uuid: string;
  timestamp: number;
  parentUuid?: string | null;
  compactMetadata: {
    trigger: "manual" | "auto";
    preTokens: number;
    postTokens?: number;
    tokensSavedByMicrocompact?: number;
    clearedToolCallIds?: string[];
  };
};
```

本期只使用 `trigger: "manual"`，但保留 `"auto"` 扩展位。`defaultConvertToLlm()` 不应把 `compact_boundary` 转给 LLM。

### Compact Summary Message

summary 对齐 Claude Code，作为 user meta message 进入后续模型上下文：

```ts
const summaryMessage: AgentMessage = {
  role: "user",
  isMeta: true,
  timestamp: Date.now(),
  content: [{
    type: "text",
    text: getCompactUserSummaryMessage(summary, transcriptPath),
  }],
};
```

内容形态：

```text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
...
```

### Command Records

compact 成功后保留命令记录：

```ts
{
  role: "user",
  content: [{ type: "text", text: "/compact ..." }],
  timestamp
}

{
  role: "user",
  isMeta: true,
  content: [{
    type: "text",
    text: "<local-command-stdout>Compacted ...</local-command-stdout>",
  }],
  timestamp
}
```

### Post-Compact Ordering

当前 full compact 顺序：

```text
compact_boundary
compact_summary_user_meta
/compact command user message
local-command-stdout meta message
restored attachments
```

如果未来支持 partial compact 或保留尾部消息，可扩展为：

```text
compact_boundary
compact_summary_user_meta
messagesToKeep
slash command records
restored attachments
```

本期不保留尾部原始对话，避免旧长历史继续进入模型上下文；关键原文通过 restored attachments 恢复。

## Compact Prompt

`prompt.ts` 按 Claude Code 的结构实现：

```text
NO_TOOLS_PREAMBLE
BASE_COMPACT_PROMPT
Additional Instructions
NO_TOOLS_TRAILER
```

`BASE_COMPACT_PROMPT` 必须包含 `DETAILED_ANALYSIS_INSTRUCTION_BASE`，要求 compact summarizer 先在 `<analysis>` 中按时间顺序梳理对话，再输出 `<summary>`。

summary 应覆盖 9 个部分：

1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and fixes
5. Problem Solving
6. All user messages
7. Pending Tasks
8. Current Work
9. Optional Next Step

`formatCompactSummary()` 必须：

- 移除 `<analysis>...</analysis>`
- 提取 `<summary>...</summary>`
- 转换成 `Summary:\n...`
- 清理多余空行

`getCompactUserSummaryMessage()` 负责把 formatted summary 包装成后续会话可读的 continuation context。

## Microcompact

本期必须实现本地 content-clearing microcompact。它的目的不是生成 summary，而是在 compact summary 请求前降低 summarizer 输入压力，防止 compact AI 自己超上下文或成本过高。

### Scope

本期实现：

- 识别 compactable tools
- 保留最近 `keepRecent` 个 toolResult
- 清理更旧 toolResult 的大 content
- 保留 toolCall/toolResult 结构配对
- 记录 `tokensSaved`、`clearedToolCallIds`、`keptToolCallIds`

本期不实现：

- provider-level `cache_edits`
- cached microcompact state
- server prompt cache editing

### Compactable Tools

白名单应覆盖 ys-code 当前主要工具：

```text
read
bash
glob
webfetch
edit
write
```

具体名称应以现有 tool `name` 常量或实际注册名为准，避免硬编码与工具实现漂移。

### Behavior

伪代码：

```text
microcompactMessages(messages, config):
  collect compactable toolCall ids in encounter order
  keepRecent = max(1, config.keepRecent)
  keepSet = last keepRecent ids
  clearSet = all compactable ids not in keepSet

  for each toolResult message:
    if toolCallId in clearSet:
      replace content with "[Old tool result content cleared]"
      record estimated tokens saved

  return {
    messages,
    info: { tokensSaved, clearedToolCallIds, keptToolCallIds }
  }
```

不能直接删除 toolResult，因为 provider 和 agent loop 通常依赖 toolCall/toolResult 成对结构。清理 content 可以降低 token，同时保持消息结构完整。

## Attachment Restore

compact 后 attachments 由工程代码恢复，不由 compact AI 总结生成。

### File Attachments

从 `FileStateCache` 快照恢复最近读取文件：

```text
1. compact 前复制 fileStateCache 当前记录
2. compact 成功后清理旧 cache
3. 选择最近读取的文件
4. 重新读取磁盘内容，而不是直接使用缓存 content
5. 生成 role:"attachment" 的 file attachment
6. 按单文件和总 token budget 过滤
```

重新读取文件的原因：

- 文件可能被 agent、用户、formatter 或其他进程修改
- 可以复用现有 read tool 的权限、大小和截断规则
- 避免把过期内容注入 post-compact context

### Other Attachments

设计上预留这些恢复源：

- plan / plan mode
- skill listing / invoked skills
- background tasks
- future MCP/tool instruction deltas

如果当前 ys-code 没有对应状态源，函数返回空数组，但接口和扩展点应保留。

## Command Handling

当前 `dispatchCommandResult()` 对 `handled=true` 且无 `metaMessages` 的命令会调用 `session.prompt(text)`。对 `/compact` 必须新增特殊分支。

建议扩展：

```ts
export type CommandResult =
  | { type: "text"; value: string }
  | { type: "skip" }
  | { type: "compact"; displayText: string };
```

`ExecuteCommandResult` 增加：

```ts
compact?: true;
```

处理逻辑：

```text
executeCommand("/compact ..."):
  command.call(args, context)
  result.type === "compact"
  return { handled: true, compact: true, textResult: result.displayText }

dispatchCommandResult(result):
  appendUserMessage(commandText)
  if result.compact:
    appendSystemMessage(displayText)
    do not call session.prompt()
    return true
```

`commands/compact/compact.ts` 内部调用：

```ts
await context.session.compact({
  instructions: args.trim(),
  commandText,
});
```

如果现有 `CommandContext` 不包含原始 `commandText`，可由 `executeCommand()` 将 input 传给 command，或让 `dispatchCommandResult()` 负责 UI 命令记录而 `AgentSession.compact()` 负责 active message command record。实现时需避免重复记录。

## Error Handling

compact 必须是原子操作：

```text
成功：
  replace active messages
  显示 Compacted

失败：
  active messages 保持不变
  显示 Error during compaction: ...

取消：
  active messages 保持不变
  显示 Compaction canceled.
```

summary 请求过长时：

```text
1. 先运行 content-clearing microcompact
2. 如果仍 prompt-too-long，按 API round 或消息顺序截断最旧消息重试
3. 达到最大重试次数仍失败，则不修改 messages
```

不允许退化成“取前几条消息拼接”的低质量 summary。失败比污染后续上下文更安全。

## Code Style

优先使用小而清晰的纯函数组织 compact 逻辑，命令层不直接操作 message 细节。

示例风格：

```ts
export function buildPostCompactMessages(result: CompactionResult): AgentMessage[] {
  return [
    result.boundaryMessage,
    result.summaryMessage,
    ...result.messagesToKeep,
    ...result.attachments,
  ];
}

export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT;

  if (customInstructions?.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions.trim()}`;
  }

  return prompt + NO_TOOLS_TRAILER;
}
```

约定：

- 文件名使用 kebab-case 或沿用现有模块风格。
- 类型名使用 PascalCase。
- 函数名使用动词开头，如 `buildPostCompactMessages()`、`createCompactBoundaryMessage()`。
- compact service 中避免 UI 依赖。
- TUI 中避免 compact 业务逻辑。
- 不新增全局 mutable 状态，除非用于明确的 future provider capability，且必须有 reset 函数。

## Testing Strategy

使用 `bun test`。

### Unit Tests

`prompt.ts`：

- `getCompactPrompt()` 包含 no-tools preamble/trailer。
- `getCompactPrompt(customInstructions)` 追加 `Additional Instructions`。
- `formatCompactSummary()` 移除 `<analysis>`。
- `formatCompactSummary()` 将 `<summary>` 转成可读 `Summary:`。

`microcompact.ts`：

- 只清理 compactable tools 的旧 `toolResult`。
- 至少保留最近 `keepRecent` 个 `toolResult`。
- 不破坏 toolCall/toolResult 配对。
- 正确统计 `tokensSaved` 和 `clearedToolCallIds`。
- 非 compactable toolResult 不被清理。

`messages.ts`：

- `createCompactBoundaryMessage()` 生成 metadata。
- `buildPostCompactMessages()` 顺序正确。
- `getMessagesAfterCompactBoundary()` 只取最后一个 boundary 之后的有效上下文。

`attachments.ts`：

- 从 `FileStateCache` 快照选择最近文件。
- 重新读取文件生成 file attachment。
- 文件不存在或超预算时 graceful skip。
- 总 token budget 生效。

### Integration Tests

`/compact` command：

- 执行 `/compact` 不调用 `session.prompt("/compact")`。
- 执行 `/compact` 会调用 `session.compact()`。
- UI 追加用户命令和 `Compacted` 提示。
- custom instructions 传入 compact service。

compact success：

- active messages 替换为 boundary + summary + command records + attachments。
- 原始长历史不再进入后续 LLM context。

compact failure：

- active messages 不变。
- UI 显示错误。

microcompact integration：

- 大 toolResult 在 summary 请求前被清理。

### Verification Commands

```bash
bun test
bun run typecheck
```

## Boundaries

Always:

- `/compact` 必须是 local command。
- `/compact` 成功后必须阻止本轮普通主模型 query。
- compact 成功后 active messages 必须变短，不让旧长历史继续进入 LLM context。
- compact 失败或取消时不修改 active messages。
- summary 使用当前会话模型生成。
- microcompact 在 summary 请求前执行。
- custom instructions 必须进入 compact prompt。
- 重要工程状态优先通过 attachments 恢复，而不是依赖 summary 回忆。

Ask first:

- 新增第三方依赖。
- 改 provider API 协议以支持 `cache_edits`。
- 引入 auto compact。
- 引入 reactive compact。
- 改 session 文件格式中不可向后兼容的字段。
- 改 TUI 消息展示规则，使 meta messages 默认可见。

Never:

- 不要把 `/compact` 当作普通用户 prompt 发给主模型。
- 不要用“取前几条消息拼接”的假 summary 作为成功 fallback。
- 不要在 compact 失败时部分替换 messages。
- 不要删除 toolCall/toolResult 配对结构。
- 不要让 cached microcompact 进入本期验收。
- 不要直接物理删除 transcript 中的历史记录作为 compact 的主要机制。

## Success Criteria

1. 用户可以在 TUI 输入 `/compact [instructions]`。
2. `/compact` 是 local command，不会被当作普通 prompt 发给主模型。
3. compact summary 使用当前会话模型生成。
4. compact prompt 对齐 Claude Code 的 analysis + summary 结构。
5. summary 生成前执行本地 content-clearing microcompact。
6. compact 成功后 active messages 被替换为：
   - `compact_boundary`
   - compact summary user meta message
   - `/compact` 命令记录
   - `local-command-stdout` meta message
   - restored attachments
7. compact 后最近文件 attachment 可以恢复；skills、plan/mode、background-task 等接口存在，当前没有状态源时返回空。
8. compact 失败或取消时不修改 active messages。
9. 本期不实现 auto compact、cached microcompact、reactive compact、session memory compact。
10. `bun test` 和 `bun run typecheck` 通过。

## Open Questions

- `AgentSession.compact()` 是否应负责构造 `/compact` command record，还是由 command/TUI 层传入并统一记录？
- `compact_boundary` 是否应扩展现有 `Entry` schema，还是先仅作为 in-memory `AgentMessage` 并在 session persistence 中保留现有 boundary entry？
- 最近文件 attachment 的预算值是否直接采用 Claude Code 风格默认值，还是按 ys-code 当前 context window 调小？
- `getMessagesAfterCompactBoundary()` 在 restore 时是否应该基于 session entries 还是 active messages 执行？
