# TUI 与 debug-agent-chat 采用 cc 风格 system prompt

## 目标

将 TUI (`src/tui/app.tsx`) 和 `examples/debug-agent-chat.ts` 的 system prompt 从呆板的 `"You are a helpful assistant"` 替换为基于 `SystemPromptSection` 的 coding-agent 结构化提示词，与 claude-code-haha 的设计对齐。

同时删除已废弃的 CLI 入口 `src/cli/chat.ts` 及其 pipe 测试。

## 架构

### 1. coding-agent system prompt builder

新建 `src/agent/system-prompt/coding-agent.ts`，用 `createSystemPromptBuilder` 组装现有 section 文件：

- `intro` — static: 身份声明
- `system` — static: 系统行为约束（工具权限、system-reminder 说明、压缩机制）
- `doing-tasks` — static: 任务执行原则（读代码再改、YAGNI、安全边界）
- `actions` — static: 执行动作时的谨慎原则（可逆性、确认策略）
- `using-your-tools` — dynamic: 基于当前 `tools` 列表生成工具使用规范
- `env-info` — dynamic: 基于 `cwd` / `model.id` 生成环境信息
- `output-efficiency` — static: 输出效率要求（简洁、直接、无废话）
- `tone-and-style` — static: 语气风格（无 emoji、短句、代码引用格式）
- `summarize-tool-results` — static: 工具结果记忆提示
- `session-specific-guidance` — static: 目前返回空字符串，预留扩展

所有 static section 使用 `getCacheKey` 返回固定值（或省略，由调用方缓存策略决定）；dynamic section 根据 `tools` / `cwd` / `model` 状态每轮重新计算。

导出单一函数：

```typescript
export function getCodingAgentSystemPrompt(
  context: SystemPromptContext
): Promise<SystemPrompt>
```

### 2. 删除废弃 CLI

- 删除 `src/cli/chat.ts`
- 删除 `src/cli/__tests__/chat-pipe.test.ts`
- `src/cli/format.ts` 和 `src/cli/__tests__/format.test.ts` 保留（`debug-agent-chat.ts` 仍在使用格式化函数）

### 3. TUI 适配

- `src/tui/hooks/useAgent.ts`：将 `UseAgentOptions.systemPrompt` 类型从 `string` 改为 `(context: SystemPromptContext) => Promise<SystemPrompt>`，直接透传给 `AgentSession`
- `src/tui/app.tsx`：删除 `process.argv[2]` 覆写逻辑，改为导入并传入 `getCodingAgentSystemPrompt`

### 4. debug-agent-chat.ts 适配

- 删除当前内联的 `"你是一个乐于助人的助手。"`
- 改为导入 `getCodingAgentSystemPrompt` 并传入 `AgentSession`

## 不变

- `examples/agent-math.ts` 保持其简洁的数学助手 system prompt 不变
- `src/agent/system-prompt/sections/` 下现有文件内容不变，仅新增组装入口
- `src/cli/format.ts` 不变

## 测试验证

- `bun tsc --noEmit` 全量通过
- `bun test src/` 通过（注意 `chat-pipe.test.ts` 已被删除）
- `bun run src/tui/index.tsx` 能正常启动（手动验证）
- `bun run examples/debug-agent-chat.ts` 输出正常
