# Implementation Plan: Compact Debug Example

## Overview

本计划基于 `docs/ys-powers/specs/2026-05-03-compact-debug-example-design.md`，在 `examples/` 下新增一个一键运行的 compact debug 脚本。目标不是增加新的 compact 能力，而是提供一个尽量贴近真实 TUI 的调试入口：创建真实 `AgentSession`、使用真实 model/api key、通过 `executeCommand("/compact ...")` 触发内置 local command，并打印 compact 前后的 active messages、boundary metadata、summary、attachments 和 session JSONL 尾部信息。

## Architecture Decisions

- 主路径必须走 `executeCommand("/compact ...")`，不直接调用 `AgentSession.compact()` 或 `compactConversation()`，确保能覆盖 command registry 和 local command result 行为。
- example 使用真实 `AgentSession`、真实 tools、真实 summary model 和真实 session storage；不提供 mock/fake/no-model 模式。
- 脚本创建临时 `workspace/` 和 `sessions/`，避免写入用户默认 session 目录；默认保留临时目录，方便检查 debug 证据。
- 不新增 `package.json scripts`，运行方式固定为 `bun run examples/debug-compact.ts`。
- 不支持 `--model-provider` / `--model-id`，沿用现有 examples 的 MiniMax 默认模型。
- 实现以 example 自包含 helper 为主，不修改 production compact 逻辑；如发现必须改核心代码，应暂停确认。

## Dependency Graph

```text
Spec contract
  -> debug script helper functions
    -> isolated workspace/session setup
      -> real AgentSession setup and event subscription
        -> seed one real model turn
          -> executeCommand("/compact ...")
            -> inspect post-compact messages
              -> inspect transcript tail
                -> manual verification and typecheck
```

关键依赖：

- `examples/debug-agent-chat.ts` 提供真实 `AgentSession` 和 CLI event formatting 的现有风格。
- `src/commands/index.ts` 的 `executeCommand()` 是必须经过的 slash command 入口。
- `src/commands/types.ts` 的 `CommandContext` 决定 example 如何模拟 TUI callbacks。
- `src/agent/session.ts` 负责真实 compact 执行和 session replacement。
- `src/session/session-storage.ts` 的 JSONL transcript 是 debug 输出需要读取的目标。

## Task List

### Phase 1: Foundation - 可测试 helper 和隔离环境

## Task 1: 建立 debug-compact helper 测试骨架

**Description:** 新增 `examples/debug-compact.test.ts`，先覆盖不依赖真实模型的 helper 契约：参数解析、message role summary 格式化、summary preview 截断、transcript tail entry 读取。这些 helper 是脚本可读输出的基础，也避免 example 全部只能靠手动验证。

**Acceptance criteria:**

- [x] 测试覆盖默认参数：无参数时 instructions 使用 spec 中默认值或脚本默认值。
- [x] 测试覆盖 `--instructions <text>` 能正确解析包含空格的中文指令。
- [x] 测试覆盖 message summary 能标记 `role` 和 `isMeta`。
- [x] 测试覆盖 transcript tail 读取只返回最后 N 条 entry type，且损坏行不会使 helper 崩溃。

**Verification:**

- [x] RED 阶段：`bun test examples/debug-compact.test.ts` 因 helper 不存在失败。
- [x] GREEN 阶段：`bun test examples/debug-compact.test.ts` 通过。

**Dependencies:** None

**Files likely touched:**

- `examples/debug-compact.test.ts`
- `examples/debug-compact.ts`

**Estimated scope:** S

## Task 2: 实现隔离 debug workspace 和 session setup

**Description:** 在 `examples/debug-compact.ts` 中实现 `createDebugWorkspace()` 和基础 CLI 入口，创建 `/tmp/ys-code-compact-debug-*` 下的 `workspace/` 与 `sessions/`，写入 `compact-target.ts` 和 `notes.md` fixture，并打印路径。此任务不创建 `AgentSession`，先把文件系统隔离和参数解析闭环。

**Acceptance criteria:**

- [ ] `bun run examples/debug-compact.ts --help` 或无 API key 前的早期输出能显示 debug root/workspace/session 路径。
- [ ] 临时 workspace 中包含 `compact-target.ts` 和 `notes.md`。
- [ ] 默认不删除临时目录。
- [ ] 不写入默认 `~/.ys-code/sessions`。

**Verification:**

- [ ] `bun test examples/debug-compact.test.ts`
- [ ] Manual check: `bun run examples/debug-compact.ts` 在缺少 API key 时仍打印 debug 路径和清晰错误。

**Dependencies:** Task 1

**Files likely touched:**

- `examples/debug-compact.ts`
- `examples/debug-compact.test.ts`

**Estimated scope:** S

### Checkpoint: Foundation

- [ ] Helper tests pass: `bun test examples/debug-compact.test.ts`
- [ ] `bun run typecheck` 通过。
- [ ] 脚本尚未触发真实模型，但隔离目录和参数行为稳定。

### Phase 2: Core - 真实 AgentSession 与 compact command 路径

## Task 3: 接入真实 AgentSession 和事件输出

**Description:** 按 `examples/debug-agent-chat.ts` 风格创建真实 `AgentSession`，使用 `getModel("minimax-cn", "MiniMax-M2.7-highspeed")` 和 `getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY`。订阅 session events，复用 `src/cli/format.ts` 的输出格式，执行一轮真实 prompt 来准备 compact 前上下文。

**Acceptance criteria:**

- [ ] 缺少 API key 时给出清晰错误，说明需要 `MINIMAX_API_KEY` 或 provider 对应 key。
- [ ] 有 API key 时创建 `AgentSession({ cwd: debugWorkspace, sessionBaseDir })`。
- [ ] 第一轮 prompt 使用真实模型执行，并要求模型读取或分析 `compact-target.ts`。
- [ ] 第一轮结束后打印 compact 前 message count 和 role summary。

**Verification:**

- [ ] `bun run typecheck`
- [ ] Manual check with API key: `bun run examples/debug-compact.ts`
- [ ] Manual check: 输出中出现真实 model turn events 和 `[BEFORE COMPACT]` message summary。

**Dependencies:** Task 2

**Files likely touched:**

- `examples/debug-compact.ts`

**Estimated scope:** M

## Task 4: 通过 executeCommand 执行 /compact

**Description:** 新增 `runCompactCommand()`，构造真实 `CommandContext`，用 debug UI event collector 实现 `appendUserMessage` / `appendSystemMessage`，通过 `executeCommand("/compact ...", context, skillsBasePath, debugWorkspace)` 触发 compact。不得直接调用 `session.compact()` 作为主路径。

**Acceptance criteria:**

- [ ] compact 主路径调用 `executeCommand()`。
- [ ] command result 打印 `handled`、`compact`、`skipPrompt`、`textResult`。
- [ ] 当 `result.compact === true` 时打印“no normal prompt dispatch”说明。
- [ ] debug UI events 会记录 appendUserMessage / appendSystemMessage，但不会调用 `session.prompt("/compact")`。

**Verification:**

- [ ] `bun run typecheck`
- [ ] Manual check with API key: compact command result 为 `handled: true` 且 `compact: true`。
- [ ] Manual check: compact 后 `session.messages` 首条为 `compact_boundary`。

**Dependencies:** Task 3

**Files likely touched:**

- `examples/debug-compact.ts`

**Estimated scope:** M

### Checkpoint: Real Compact Path

- [ ] 手动运行 `bun run examples/debug-compact.ts` 能完成一轮 prompt 和一次 `/compact`。
- [ ] 输出证明走的是 local compact result，不是普通 prompt dispatch。
- [ ] `bun run typecheck` 通过。
- [ ] 未修改 production compact 逻辑。

### Phase 3: Debug 输出完整性和验证收尾

## Task 5: 输出 post-compact messages、metadata 和 attachments

**Description:** 补齐 compact 后 inspect 输出，包括 role ordering、`compact_boundary.compactMetadata`、summary preview、attachment 概览。输出面向人工 debug，要求稳定可读，不要求机器解析。

**Acceptance criteria:**

- [ ] compact 后打印 message count 和每条 message 的 role/meta 信息。
- [ ] 如果存在 `compact_boundary`，打印 `compactMetadata` JSON。
- [ ] 如果存在 summary meta message，打印前 800 字符 preview。
- [ ] 如果存在 attachments，打印数量、`displayPath` 和行数；没有 attachment 时打印明确提示。

**Verification:**

- [ ] `bun test examples/debug-compact.test.ts`
- [ ] `bun run typecheck`
- [ ] Manual check with API key: 输出中包含 `[AFTER COMPACT]`、`compactMetadata`、`summary preview`。

**Dependencies:** Task 4

**Files likely touched:**

- `examples/debug-compact.ts`
- `examples/debug-compact.test.ts`

**Estimated scope:** S

## Task 6: 输出 session transcript tail 并补最终验证说明

**Description:** 读取 `sessionBaseDir` 下最新 JSONL transcript，打印 session file path 和最后 N 条 entry type，帮助确认 append-only 行为。最后整理运行说明和失败排查提示在脚本顶部注释或 README 风格输出中。

**Acceptance criteria:**

- [ ] 输出 session JSONL 文件路径。
- [ ] 输出最新 entry types，例如 `compact_boundary -> user -> user`。
- [ ] transcript tail helper 能跳过损坏行，不泄露整行内容。
- [ ] 脚本结束时打印 debug root 保留路径。
- [ ] 不新增 `package.json scripts`。

**Verification:**

- [ ] `bun test examples/debug-compact.test.ts`
- [ ] `bun run typecheck`
- [ ] Manual check with API key: 打开打印的 JSONL 路径能看到尾部 compact entries。

**Dependencies:** Task 5

**Files likely touched:**

- `examples/debug-compact.ts`
- `examples/debug-compact.test.ts`

**Estimated scope:** S

### Checkpoint: Complete

- [ ] `bun test examples/debug-compact.test.ts` 通过。
- [ ] `bun run typecheck` 通过。
- [ ] 手动运行 `bun run examples/debug-compact.ts` 完成真实 compact debug flow。
- [ ] 输出包含 spec 要求的 before/after、command result、boundary metadata、summary preview、attachments、session JSONL 路径和 transcript tail。
- [ ] 没有新增依赖、没有新增 package script、没有修改 production compact 逻辑。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 真实模型没有读取 `compact-target.ts`，导致 attachment 不出现 | Medium | prompt 中明确要求读取文件；输出中允许“无 attachment 候选”的可读提示 |
| example 依赖真实 API key，无法在 CI 稳定运行 | Medium | 不把真实模型运行放入自动测试；CI 只跑 helper tests 和 typecheck |
| debug fixture 中出现 secret-like 字符串触发 push protection | Medium | fixture 使用普通代码和说明文本，不写完整 provider token 形态 |
| 为了 debug 方便而改动 production compact path | High | plan 明确禁止；如必须改核心逻辑先暂停确认 |
| 临时 session 污染用户默认数据 | High | 必须传入隔离 `sessionBaseDir`，并在输出中打印路径 |
| 手动运行耗时或成本高 | Low | 单轮 seed prompt + 单次 compact；不做多轮交互 |

## Parallelization Opportunities

当前任务较小，不建议并行实现。可并行的只有 review 阶段：

- 一名 reviewer 检查 example 是否真的走 `executeCommand()`。
- 一名 reviewer 检查 debug 输出是否足够定位 compact 问题。
- 一名 reviewer 检查是否误引入真实 API key 测试或默认 session 写入。

## Open Questions

无。已决策：

- 不新增 `package.json scripts`。
- 不支持 `--model-provider` / `--model-id`。
- 不提供 `--cleanup`。
- 不提供无真实模型的内部 debug 模式。
