# Spec: Compact Debug Example

## Objective

在 `examples/` 下新增一个可一键运行的 compact debug 脚本，用于在接近真实 TUI 的环境中观察 `/compact` 的完整闭环。

**背景：**
- 当前 `/compact` 已实现为内置 local command，并通过 `AgentSession.compact()`、`compactConversation()`、`SessionManager.replaceMessages()` 完成 active context 替换和 transcript append。
- 单元测试已覆盖核心边界，但开发者调试 compact 时仍缺少一个能直接运行、能打印 before/after 状态、能检查真实 session JSONL 的 example。
- 现有 `examples/debug-agent-chat.ts`、`examples/debug-skill-invocation.ts` 等脚本已经采用真实 `AgentSession`、真实 model/api key、真实事件订阅的风格。本需求应沿用这种模式，而不是写一个只调用内部纯函数的 demo。

**目标用户：**
- compact 功能维护者：需要快速复现 `/compact` 的命令路径、summary 生成、message replacement、attachment restore 和 transcript append。
- 调试 TUI/command/session 集成的开发者：需要确认 `/compact` 不会退回普通 `session.prompt("/compact")` 路径。
- 后续 agent：需要一个可运行入口来观察 compact 真实行为，而不是只读测试代码。

**成功标准：**
- [ ] 新增 `examples/debug-compact.ts`。
- [ ] 默认一键运行，不需要 readline 交互。
- [ ] 脚本走 `executeCommand("/compact ...")`，而不是直接调用 `AgentSession.compact()` 或 `compactConversation()` 作为主路径。
- [ ] 脚本使用真实 `AgentSession`、真实 model/api key、真实 command registry、真实 session storage。
- [ ] 脚本创建隔离的临时 cwd 和临时 `sessionBaseDir`，不污染用户默认 session。
- [ ] 脚本能准备可观察的 compact 前上下文，使 compact 前后 message roles、summary、boundary metadata 和 transcript 变化清晰可见。
- [ ] 脚本输出 compact 前后关键信息：message count、role ordering、command result、boundary metadata、summary preview、attachments、session file path、latest transcript entries。
- [ ] 脚本明确验证 `/compact` 没有触发普通 prompt path。
- [ ] 缺少 API key 或 compact 执行失败时给出可读错误，并保留 debug 目录路径。
- [ ] 不新增第三方依赖。

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript / ESM
- **Agent Runtime:** `AgentSession`
- **Command System:** `executeCommand()` + `CommandContext`
- **Model:** 默认沿用现有 examples 的 `getModel("minimax-cn", "MiniMax-M2.7-highspeed")`
- **API Key:** `getEnvApiKey(model.provider)` 或 `process.env.MINIMAX_API_KEY`
- **Storage:** 临时 `sessionBaseDir` 下的真实 JSONL session transcript
- **Test Framework:** `bun:test`
- **无需新增依赖**

## Commands

```bash
# 运行 compact debug example
bun run examples/debug-compact.ts

# 可选：传入 compact instructions
bun run examples/debug-compact.ts --instructions "只保留当前任务、文件路径、错误和下一步"

# 可选：保留/打印 debug 目录，默认也应打印路径
bun run examples/debug-compact.ts --keep

# 针对脚本的静态检查
bun run typecheck

# compact 相关回归测试
bun test \
  src/session/compact \
  src/agent/session.test.ts \
  src/commands/index.test.ts \
  src/tui/command-utils.test.ts \
  src/session/session-manager.test.ts \
  src/session/session-loader.test.ts \
  src/session/session-storage.test.ts
```

## Project Structure

```text
examples/
  debug-compact.ts
    -> 新增：一键复现 compact 真实 command 路径，输出 before/after debug 信息

src/
  agent/
    session.ts
      -> 只读依赖：通过 AgentSession 创建真实会话，不为 example 改核心逻辑
  commands/
    index.ts
      -> 只读依赖：通过 executeCommand 模拟 TUI slash command dispatch
    compact/
      -> 只读依赖：真实 /compact local command
  session/
    compact/
      -> 只读依赖：真实 compact service

docs/
  ys-powers/
    specs/
      2026-05-03-compact-debug-example-design.md
        -> 本 spec
```

本需求默认只新增 example 和必要的轻量测试。如果实现过程中发现必须改核心代码，应先暂停并说明原因。

## Code Style

沿用现有 `examples/debug-*.ts` 的风格：脚本顶部集中 import，直接创建 `AgentSession`，通过 `session.subscribe()` 打印 agent 事件，并用小型 helper 函数组织 debug 输出。

**主流程应清晰地表达真实路径：**

```ts
const commandContext = {
  session,
  appendUserMessage: (text: string) => debugUiEvents.push({ type: "user", text }),
  appendSystemMessage: (text: string) => debugUiEvents.push({ type: "system", text }),
  resetSession: () => {
    throw new Error("resetSession is not supported in debug-compact");
  },
};

const result = await executeCommand(
  `/compact ${instructions}`,
  commandContext,
  join(debugCwd, ".claude/skills"),
  debugCwd,
);
```

**输出 helper 保持可扫读：**

```ts
function printMessageSummary(label: string, messages: readonly AgentMessage[]): void {
  console.log(`\n[${label}] messages=${messages.length}`);
  messages.forEach((message, index) => {
    console.log(`  ${index + 1}. ${message.role}${message.isMeta ? " meta" : ""}`);
  });
}
```

**约定：**
- helper 函数使用动词开头，如 `createDebugWorkspace()`、`seedConversation()`、`runCompactCommand()`、`printCompactResult()`。
- debug 输出使用 `[DEBUG]`、`[SETUP]`、`[COMPACT]`、`[TRANSCRIPT]` 前缀。
- example 不依赖测试专用 mock，不修改 production compact path。
- example 中的 fixture 不包含真实 secret，也不使用会触发 GitHub Push Protection 的完整 token 形态。

## Runtime Design

### 1. 创建隔离环境

脚本启动后创建临时目录：

```text
/tmp/ys-code-compact-debug-<timestamp>/
  workspace/
    compact-target.ts
    notes.md
  sessions/
    *.jsonl
```

`workspace/` 作为 `AgentSession.cwd`。`sessions/` 作为 `sessionBaseDir`。脚本结束时打印这两个路径，方便开发者检查。

默认建议保留临时目录，便于 debug transcript。后续如果需要清理，可增加 `--cleanup`，但不作为本期必需。

### 2. 创建真实 AgentSession

脚本使用真实 model 和真实 tools：

```ts
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const session = new AgentSession({
  cwd: debugWorkspace,
  model,
  apiKey,
  sessionBaseDir,
});
```

缺少 API key 时直接退出，并说明需要配置的环境变量。

### 3. 准备 compact 前上下文

为了让 compact 可观察，脚本需要准备以下材料：

- 一个真实文件，例如 `compact-target.ts`。
- 一段用户任务，例如“阅读 compact-target.ts 并总结下一步”。
- 至少一次真实模型 turn，让 agent 有机会调用 Read/Bash 等工具并填充 `FileStateCache`。
- 若真实模型没有读取文件，脚本应提示“未产生 file attachment 候选”，但仍继续执行 compact。

如果要保证可重复性，可以在 prompt 中明确要求模型读取指定文件。不要直接调用 `compactConversation()` 塞假数据作为主路径。

### 4. 执行真实 slash command

执行 compact 必须通过：

```text
executeCommand("/compact ...", commandContext, skillsBasePath, debugCwd)
```

`commandContext.appendUserMessage` 和 `appendSystemMessage` 只记录 debug UI events，不直接调用 `session.prompt()`。

脚本应记录是否发生普通 prompt path。由于 `executeCommand()` 本身不会调用 `dispatchCommandResult()`，example 可以通过 command result 判断：

```text
handled === true
compact === true
skipPrompt !== true
```

并打印：

```text
[COMPACT] command path: local compact result, no normal prompt dispatch
```

### 5. 输出 compact 后状态

脚本应打印：

- compact 前后 `session.messages.length`
- compact 前后 message role 顺序
- `compact_boundary.compactMetadata`
- summary preview，例如前 800 字符
- attachments 的数量、`displayPath`、行数
- `textResult`
- session JSONL 文件路径
- transcript 最新 entry types

输出只用于 debug，不要求机器可解析。

## Testing Strategy

### 自动测试

本需求主要是 example 脚本，不应引入需要真实 API key 的 CI 测试。

建议添加轻量测试时只覆盖纯 helper：

- 参数解析：`--instructions`、`--keep`
- message summary formatting
- transcript tail entry 读取

如果 helper 很少，也可以不新增测试，只依赖 typecheck 和手动运行验证。

### 手动验证

必须手动运行：

```bash
bun run examples/debug-compact.ts
```

预期现象：

- 脚本启动后打印 debug workspace 和 sessionBaseDir。
- 第一轮真实 prompt 正常完成。
- `/compact` 返回 `handled: true` 和 `compact: true`。
- compact 后 messages 中出现 `compact_boundary`。
- summary message 是 user meta message。
- session JSONL 中尾部追加 compact boundary 和 summary 等 entries。
- 脚本没有把 `/compact` 当作普通 prompt 发送给主模型。

### 回归验证

实现完成后运行：

```bash
bun run typecheck
bun test src/commands/index.test.ts src/agent/session.test.ts src/session/compact
```

如果 example 抽出了可测试 helper，再运行对应 example helper test。

## Boundaries

### Always

- 始终通过 `executeCommand("/compact ...")` 触发 compact 主路径。
- 始终使用真实 `AgentSession` 和真实 session storage。
- 始终创建隔离临时 cwd 和 `sessionBaseDir`。
- 始终打印 session JSONL 路径，便于检查 append-only 行为。
- 始终在输出中清楚标记 compact 前后 messages 和 boundary metadata。
- 始终保持 example 对 production 代码零副作用。

### Ask First

- 是否新增 package script，例如 `"example:debug-compact"`。
- 是否修改 `AgentSession` 暴露新的 debug API。
- 是否为 example 引入 mock model、fake provider 或测试专用工具。
- 是否让脚本默认删除 debug 临时目录。
- 是否支持多 provider/model 选择参数。

### Never

- 不要把主调试路径写成直接调用 `compactConversation()`。
- 不要在 example 中提交真实 API key、token 或密钥形态 fixture。
- 不要修改 compact production 逻辑来迁就 example。
- 不要让 example 写入默认用户 session 目录。
- 不要把需要真实 API key 的测试加入默认 CI。
- 不要在 compact 失败时隐藏原始错误上下文；debug 脚本应打印可定位的信息。

## Success Criteria

1. `examples/debug-compact.ts` 可以通过 `bun run examples/debug-compact.ts` 启动。
2. 脚本使用真实 model/api key 创建 `AgentSession`。
3. 脚本通过真实 `executeCommand("/compact ...")` 执行 compact。
4. 脚本使用隔离临时 workspace 和 `sessionBaseDir`。
5. 脚本输出 compact 前后 messages 的 role 顺序和数量。
6. 脚本输出 compact command result，并能看出本轮没有普通 prompt dispatch。
7. 脚本输出 `compact_boundary.compactMetadata`。
8. 脚本输出 summary preview 和 attachment 概览。
9. 脚本输出 session JSONL 路径和最新 entry 类型。
10. `bun run typecheck` 通过。

## Resolved Decisions

- 不把运行命令加入 `package.json scripts`；使用 `bun run examples/debug-compact.ts` 直接运行。
- 不支持 `--model-provider` / `--model-id`；继续沿用现有 examples 的 MiniMax 默认模型。
- 不提供 `--cleanup`；默认保留临时目录，方便检查 debug workspace 和 session JSONL。
- 不提供无真实模型的内部 debug 模式；本 example 的目标是完全模拟真实 compact 环境。

## Open Questions

无。
