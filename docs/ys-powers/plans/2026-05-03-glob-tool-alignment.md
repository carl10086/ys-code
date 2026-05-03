# Implementation Plan: GlobTool 对齐 Claude Code

## Overview

本计划基于 `docs/ys-powers/specs/2026-05-03-glob-tool-alignment-design.md`，将现有 `GlobTool` 从简单的 `rg --files` 包装升级为更接近 Claude Code 行为契约的文件名搜索工具。实现重点是：保持模型可见 schema 简洁，仅暴露 `pattern/path`；补齐路径解析和工作区 containment；让 `rg` 执行具备输出上限、超时、取消和安全排除；最后接入现有 `search_result` TUI 展示与集成测试。

## Architecture Decisions

- `GlobTool` 继续使用 `defineAgentTool`、TypeBox schema、`formatResult`、`renderResult` 的当前工具模式，不引入 Claude Code 的完整 `Tool`/permission framework。
- 输入 schema 保持 Claude Code 兼容：只暴露 `pattern` 和 `path`，不把 `head_limit`、`offset`、`hidden`、`no_ignore` 等内部策略暴露给模型。
- 路径安全边界采用 `GrepTool` 已验证的 `resolve` + `realpath` + containment 思路。absolute glob 只作为 pattern 便利能力，不允许绕过 `cwd`。
- 本轮不抽出共享 search runner，避免回头改动刚 ship 的 `GrepTool`。如实现中发现明显重复，只允许在 `glob.ts` 内局部复制小 helper。
- TUI 复用现有 `ToolRenderResult.type === "search_result"` 和 `MessageItem` 渲染路径，优先让 `GlobTool.renderResult()` 适配现有 UI，而不是扩展新的 render type。

## Dependency Graph

```text
Spec contract
  -> Glob input schema and validation
    -> path / absolute glob resolution
      -> rg argument construction
        -> bounded rg execution and truncation
          -> GlobOutput and formatResult
            -> renderResult(search_result)
              -> MessageItem / tool-execution integration tests
```

关键依赖：
- `src/agent/tools/glob.ts` 是主变更点，后续所有测试依赖它的输出结构稳定。
- `src/agent/types.ts` 当前已经支持 `search_result`，大概率不需要修改。
- `src/tui/components/MessageItem.tsx` 当前已能渲染 `files_with_matches` 的 `search_result`，计划中只在 Glob 发现展示差异时做最小补齐。
- `src/agent/tool-execution.test.ts` 已有真实 `GrepTool` renderData 穿透测试，`GlobTool` 可用同样模式补回归。

## Task List

### Phase 1: Foundation - 输入契约和路径安全

## Task 1: 建立 GlobTool 行为测试骨架

**Description:** 新增 `src/agent/tools/glob.test.ts`，先用临时 fixture 覆盖当前必须稳定的用户可见契约：默认搜索、无结果、`path` 限定、路径不存在、路径为文件、`"undefined"`/`"null"` 拒绝。该任务先暴露当前实现差距，为后续任务提供红灯测试。

**Acceptance criteria:**
- [ ] 测试文件创建统一 fixture helper，使用 `mkdtemp` 和 `rm(..., { recursive: true, force: true })` 清理。
- [ ] 覆盖 `formatResult` 的 `No files found` 和路径列表输出。
- [ ] 覆盖 `validateInput` 对不存在目录、文件路径和伪空字符串 path 的错误。

**Verification:**
- [ ] 定向测试可运行：`bun test ./src/agent/tools/glob.test.ts`
- [ ] 预期存在失败用例，失败点对应 spec 差距而非测试环境问题。

**Dependencies:** None

**Files likely touched:**
- `src/agent/tools/glob.test.ts`

**Estimated scope:** S

## Task 2: 实现输入长度校验、path 校验和 workspace containment

**Description:** 修改 `src/agent/tools/glob.ts` 的 schema 和 `validateInput`，补 `maxLength`、`"undefined"`/`"null"` 拒绝、`resolve`/`realpath` containment、symlink 越界拒绝和稳定错误码。此任务只处理显式 `path`，不处理 absolute glob。

**Acceptance criteria:**
- [ ] `pattern` 和 `path` 都有明确最大长度。
- [ ] `path` 为 `"undefined"` 或 `"null"` 返回输入错误，并提示应省略字段。
- [ ] `path` 必须存在且为目录；不存在返回 errorCode `1`，文件返回 errorCode `2`。
- [ ] `path` 经过 `realpath` 后必须位于 `realpath(cwd)` 内，symlink 指向外部时被拒绝。

**Verification:**
- [ ] `bun test ./src/agent/tools/glob.test.ts`
- [ ] `bun run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `src/agent/tools/glob.ts`
- `src/agent/tools/glob.test.ts`

**Estimated scope:** M

## Checkpoint: Foundation

- [ ] `GlobTool` 基础输入测试通过。
- [ ] `bun run typecheck` 通过。
- [ ] 没有修改 `GrepTool` 或 TUI 文件。
- [ ] 路径错误消息足够明确，便于模型恢复。

### Phase 2: Core - absolute glob 和 rg 执行边界

## Task 3: 支持 absolute glob 拆分和相对输出

**Description:** 在 `glob.ts` 内新增 `extractGlobBaseDirectory` 和搜索参数归一化逻辑。relative glob 继续以 `path ?? cwd` 为搜索根；absolute glob 拆为 `searchDir` + `searchPattern`，且 `searchDir` 必须位于 `cwd` 内。最终输出始终相对 `cwd`，而不是相对搜索目录。

**Acceptance criteria:**
- [ ] `/repo/src/**/*.ts` 能搜索 `/repo/src` 并输出 `src/a.ts`。
- [ ] `/repo/package.json` 能作为 literal path 搜索并输出 `package.json`。
- [ ] absolute glob 指向 `cwd` 外部时返回输入错误，不执行 `rg`。
- [ ] 同时传入 `path` 和 absolute `pattern` 时，absolute pattern 必须位于 `path` 对应根内，否则返回输入错误。

**Verification:**
- [ ] `bun test ./src/agent/tools/glob.test.ts`
- [ ] 手动检查测试断言中不包含临时目录绝对路径。

**Dependencies:** Task 2

**Files likely touched:**
- `src/agent/tools/glob.ts`
- `src/agent/tools/glob.test.ts`

**Estimated scope:** M

## Task 4: 重写 rg 执行为 bounded runner

**Description:** 将当前一次性 `new Response(proc.stdout).text()` 改为受控读取：最多读取 `MAX_RESULTS + 1` 行判断截断，stderr 有 byte limit，支持 `context.abortSignal` 和默认 timeout。保持 `rg` exit code `0/1` 为成功，其余错误清晰返回。

**Acceptance criteria:**
- [ ] 结果刚好 100 条时 `truncated === false`。
- [ ] 结果超过 100 条时只返回 100 条且 `truncated === true`。
- [ ] stdout/stderr 都有上限，异常 stderr 不会无限进入错误消息。
- [ ] `AbortSignal` 或 timeout 会终止进程，并返回清晰错误或 timeout 标记，不挂起测试。
- [ ] `rg` exit code `1` 被视为无结果，不抛错。

**Verification:**
- [ ] `bun test ./src/agent/tools/glob.test.ts`
- [ ] `bun run typecheck`

**Dependencies:** Task 3

**Files likely touched:**
- `src/agent/tools/glob.ts`
- `src/agent/tools/glob.test.ts`

**Estimated scope:** M

## Task 5: 注入默认安全排除和排序语义测试

**Description:** 补齐 VCS、大目录、构建目录和常见 secret 的 deny glob 注入，保持 `--hidden` 能力，同时防止 `--no-ignore` 带来的敏感路径暴露。覆盖修改时间排序和排除规则。

**Acceptance criteria:**
- [ ] `.git/**`、`node_modules/**`、`dist/**`、`build/**` 默认不返回。
- [ ] `.env`、`.npmrc`、`.ssh/**`、`*.pem`、`*secret*` 等默认不返回。
- [ ] 排除规则覆盖根目录和嵌套目录。
- [ ] 正常文件仍按 `--sort=modified` 的结果稳定输出，测试中通过控制 mtime 或 fixture 顺序保持可预期。

**Verification:**
- [ ] `bun test ./src/agent/tools/glob.test.ts`
- [ ] 检查 `formatResult` 输出不包含 secret fixture 路径。

**Dependencies:** Task 4

**Files likely touched:**
- `src/agent/tools/glob.ts`
- `src/agent/tools/glob.test.ts`

**Estimated scope:** M

## Checkpoint: Core

- [ ] `bun test ./src/agent/tools/glob.test.ts` 通过。
- [ ] `bun run typecheck` 通过。
- [ ] `GlobTool` 已满足 schema、路径安全、absolute glob、截断、排除和格式化契约。
- [ ] 决策复核：如果实现选择改变 `.gitignore` / `--no-ignore` 策略，先更新 spec 再继续。

### Phase 3: Integration - TUI 和执行链路

## Task 6: 为 GlobTool 增加 renderResult 并验证 TUI 展示

**Description:** 给 `GlobTool` 增加 `renderResult`，返回现有 `search_result` 类型的 `files_with_matches` 数据。优先不改 `MessageItem`；如现有展示已经满足需求，只补测试。

**Acceptance criteria:**
- [ ] `renderResult` 返回 `{ type: "search_result", mode: "files_with_matches", numFiles, filenames, truncated, appliedLimit }`。
- [ ] TUI 摘要显示 `Found N files`，详情显示相对路径列表。
- [ ] 截断时摘要包含 limit/truncated 信息。
- [ ] pattern/path 或结果中的控制序列不会污染终端展示。

**Verification:**
- [ ] `bun test ./src/tui/components/MessageItem.integration.test.tsx`
- [ ] `bun test ./src/agent/tools/glob.test.ts`

**Dependencies:** Task 5

**Files likely touched:**
- `src/agent/tools/glob.ts`
- `src/tui/components/MessageItem.integration.test.tsx`
- `src/tui/components/MessageItem.tsx`（仅当现有渲染不足时）

**Estimated scope:** S

## Task 7: 增加真实 GlobTool tool-execution renderData 回归

**Description:** 在 `src/agent/tool-execution.test.ts` 中仿照真实 `GrepTool` 测试，创建临时目录和真实 `GlobTool`，确认 `renderData` 能从 `renderResult` 穿透到 `tool_execution_end` event。

**Acceptance criteria:**
- [ ] `tool_execution_end` event 的 `result.renderData.type === "search_result"`。
- [ ] `mode === "files_with_matches"`。
- [ ] `filenames` 包含相对路径，不包含临时目录绝对路径。

**Verification:**
- [ ] `bun test ./src/agent/tool-execution.test.ts`
- [ ] `bun test ./src/agent/tools/glob.test.ts`

**Dependencies:** Task 6

**Files likely touched:**
- `src/agent/tool-execution.test.ts`

**Estimated scope:** S

## Checkpoint: Integration

- [ ] `bun test ./src/agent/tools/glob.test.ts` 通过。
- [ ] `bun test ./src/tui/components/MessageItem.integration.test.tsx` 通过。
- [ ] `bun test ./src/agent/tool-execution.test.ts` 通过。
- [ ] TUI 不需要新增 render type。

### Phase 4: Final Verification and Review

## Task 8: 全量验证和手动验收

**Description:** 运行 spec 指定的最终验证命令，检查 lints，并在 TUI 中手动让 agent 使用 `Glob` 查找文件，确认输出简洁、相对路径、安全排除和截断提示都符合预期。

**Acceptance criteria:**
- [ ] 定向测试全部通过。
- [ ] `bun test` 通过。
- [ ] `bun run typecheck` 通过。
- [ ] `ReadLints` 没有新增相关诊断。
- [ ] 手动 TUI 验证记录清楚，如无法运行需说明原因。

**Verification:**
- [ ] `bun test ./src/agent/tools/glob.test.ts`
- [ ] `bun test ./src/tui/components/MessageItem.integration.test.tsx`
- [ ] `bun test ./src/agent/tool-execution.test.ts`
- [ ] `bun test`
- [ ] `bun run typecheck`
- [ ] `bun run tui`

**Dependencies:** Task 7

**Files likely touched:**
- No code expected unless verification uncovers issues.

**Estimated scope:** S

## Checkpoint: Complete

- [ ] 所有 spec success criteria 均有测试或手动验收覆盖。
- [ ] `GlobTool` 未扩大模型可见 schema。
- [ ] 未引入新依赖、未修改 `refer/`、未触碰 `main`。
- [ ] 变更集中在 `feat/glob-tool-alignment` worktree。
- [ ] 准备进入 `/review` 或 `/ship` 前，先确认 `git status` 只包含本功能相关文件。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `--no-ignore` 与安全排除冲突，仍可能返回敏感路径 | High | 默认注入 deny glob，测试覆盖 secret fixture；如仍有风险，先更新 spec 再改为尊重 `.gitignore` |
| absolute glob 与 `path` 同时存在时语义复杂 | Medium | 采用 spec 中的保守规则：`path` 决定根，absolute pattern 必须在根内 |
| 流式读取和 timeout 在 Bun 上存在进程清理边界 | Medium | 用 GrepTool 已验证模式实现；测试覆盖 cancellation/timeout 不挂起 |
| 修改 TUI 造成 Grep 展示回归 | Medium | 优先不改 `MessageItem`；如必须修改，跑 Grep 相关 TUI 测试 |
| 排序测试依赖文件系统 mtime 精度 | Low | 测试中显式 `utimes` 或避免强断言完整顺序，只验证稳定关键相对顺序 |

## Parallelization Opportunities

- Task 1 完成后，Task 2 和 Task 3 必须顺序推进，因为 absolute glob 依赖 containment 基础。
- Task 4 和 Task 5 也应顺序推进，因为排除规则测试依赖 bounded runner 的输出语义。
- Task 6 和 Task 7 可由不同 agent 在 Task 5 后并行准备，但最终需要同一分支串联验证。
- Task 8 必须最后执行。

## Open Questions

- EAGAIN 单线程重试是否进入本轮实现？计划默认不作为阻塞项，只要求错误清晰且不会误判为无结果。
- `GlobTool` TUI 显示名是否改为 Claude Code 的 `Search`？计划默认不改，避免 UI 语义扩散。
- 若实现中发现 `--no-ignore` 的风险无法靠 deny glob 覆盖，是否接受改为尊重 `.gitignore`？需要先更新 spec 并让用户确认。
