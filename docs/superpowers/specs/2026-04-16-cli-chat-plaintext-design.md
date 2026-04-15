# CLI Chat 纯文本交互设计

> 基于 `src/cli/chat.ts` 的纯文本、append-only 交互升级。零 ANSI 依赖，零 TTY 检测，完全兼容 pipe 重定向和日志调试。

## 目标

让 `bun run src/cli/chat.ts` 的终端交互具备清晰的消息边界、可读的 thinking 展示、直观的工具执行记录，同时保证所有输出都是纯文本追加，可直接重定向到文件或用 `grep` 分析。

## 核心原则

- **纯文本**：不使用任何 ANSI escape codes（无颜色、无清行、无光标重绘）
- **Append-only**：所有内容只向下追加，不覆盖已输出内容
- **调试友好**：输出重定向到文件后仍然完全可读，便于日志分析和问题排查
- **最小改动**：在现有 `chat.ts` 基础上重构事件处理逻辑，不引入新的渲染类或复杂架构

## 交互规范

### 1. 用户消息

每行以 `>` 开头，前后各空一行：

```
> hello

> list files in src/agent
```

### 2. AI 回复块

以 `Assistant` 标签开始， followed by 分隔线 `---`：

```
Assistant
---
> The user sent a greeting. I should respond warmly.

Hello! How can I help you today?
---
Tokens: 640 | Cost: $0.000218 | 0.8s
```

**结构说明：**
- `Assistant\n---` 作为回复开始标记
- thinking 内容每行以 `> ` 前缀缩进，段落之间不额外空行
- 正文正常左对齐输出，流式追加时不做任何重绘
- 回复结束以 `---` 分隔线 + 元数据行（Tokens | Cost | Time）收尾

### 3. 工具执行记录

工具调用直接追加在 AI 回复块内部或下方：

```
Assistant
---
I'll check the files for you.

-> read_file(path: "src/agent")
OK read_file -> 1.2KB 0.3s

Here are the files:
• agent.ts
• agent-loop.ts
---
Tokens: 1,024 | Cost: $0.000352 | 1.1s
```

**符号规范：**
- 开始：`-> {toolName}({args})`
- 成功：`OK {toolName} -> {summary} {time}s`
- 失败：`ERR {toolName} -> {error} {time}s`
- 参数展示最多前 2 个键值对，截断到 40 字符

### 4. slash 命令反馈

保持现有行为，命令执行结果直接输出：

```
> /tools
read, write, edit, bash

> /new
Session reset.
```

## 事件到输出的映射

| Agent 事件 | 输出行为 |
|---|---|
| `agent_start` | 无输出（或仅内部标记） |
| `turn_start` | 输出 `\nAssistant\n---\n` |
| `message_update` (thinking_delta) | 追加 `> {delta}` |
| `message_update` (text_delta) | 直接追加文本 |
| `tool_execution_start` | 追加 `\n-> {toolName}({args})\n` |
| `tool_execution_end` | 追加 `{status} {toolName} -> {summary} {time}s\n` |
| `turn_end` | 追加 `---\nTokens: {n} \| Cost: ${c} \| {time}s\n` |
| `agent_end` | 无输出 |

## 错误处理

- **意外中断**：由于 append-only，中断不会留下脏光标或半行 ANSI
- **空 thinking**：thinking 为空时不输出任何缩进行
- **无 usage**：`turn_end` 时如果没有 usage 数据，Tokens/Cost 显示为 `0`

## 测试策略

- **Pipe 测试**：直接 pipe 输入给 `bun run src/cli/chat.ts`，验证输出可被 `grep` 正确匹配
- **工具记录测试**：断言输出中包含 `-> read_file` 和 `OK read_file ->`
- **Thinking 测试**：断言输出中包含 `>` 前缀的 thinking 内容
- **无 ANSI 测试**：验证输出字符串中不包含 `\x1b` 字符

## 文件变更

- **修改**：`src/cli/chat.ts` — 重构 `agent.subscribe()` 内的输出逻辑，按本规范输出纯文本格式
