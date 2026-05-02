# Plan: GrepTool 对齐 Claude Code

## Overview

本计划基于 `docs/ys-powers/specs/2026-05-02-grep-tool-alignment-design.md`，目标是实现并注册对齐 Claude Code 行为的 `GrepTool`，让 agent 使用专用只读工具完成代码内容搜索，并在 TUI 中展示可审查的搜索摘要与详情。

## 依赖关系

```text
GrepTool schema / execute / formatResult
        │
        ├── GrepTool tests
        │
        ├── tools/index.ts export
        │       │
        │       └── AgentSession default tools
        │               │
        │               └── LLM payload exposes Grep
        │
        └── search_result renderData type
                │
                ├── useAgent renderData passthrough
                │
                └── MessageItem search result rendering
```

## Architecture Decisions

- `GrepTool` 直接接入当前 `defineAgentTool` 工厂体系，不引入 Claude Code 的完整 `Tool`/permission framework。
- 搜索后端第一版依赖系统 `rg`，与当前 `Glob` 的运行时依赖保持一致；不做 vendor/embedded ripgrep resolver。
- `GrepTool` 返回两类结果：`formatResult` 面向 LLM，保留完整可推理内容；`renderResult` 面向 TUI，返回结构化 `search_result`。
- 文件访问边界按 `ys-code` 当前目标实现：尊重轻量安全排除，默认排除 VCS 目录、`node_modules`、`dist`、`build`。
- TUI 第一版支持摘要和详细内容展示，不强制复刻 Claude Code 的 `Ctrl+O` per-message focus 交互。

---

## Phase 1: GrepTool Foundation

### Task 1：纵向实现最小可用 `GrepTool`

**Description:** 新增 `src/agent/tools/grep.ts`，先完成一个可以独立执行和测试的 `Grep` tool。该任务覆盖 `pattern/path/glob/output_mode`、三种输出模式、基础目录排除、相对路径输出和 `formatResult`，为后续参数补齐与注册打基础。

**Acceptance criteria:**
- [ ] `createGrepTool(cwd)` 返回名为 `Grep` 的只读、并发安全 tool
- [ ] 支持 `files_with_matches`、`content`、`count` 三种 `output_mode`
- [ ] 默认 `output_mode` 为 `files_with_matches`
- [ ] 搜索结果路径尽量转换为相对路径
- [ ] 默认排除 `.git`、`node_modules`、`dist`、`build`
- [ ] `formatResult` 对无结果和有结果都返回清晰文本

**Verification:**
- [ ] 新增并运行 `bun test ./src/agent/tools/grep.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/agent/tools/grep.ts`
- `src/agent/tools/grep.test.ts`

**Estimated scope:** M

---

### Task 2：补齐 CC 对齐参数与边界行为

**Description:** 在 Task 1 的基础上补齐 Claude Code `GrepTool` 的参数语义，包括上下文行、分页、大小写、type 过滤、multiline 和 pattern 以 `-` 开头时的 `-e` 处理。

**Acceptance criteria:**
- [ ] 支持 `-A`、`-B`、`-C`、`context`，且 `context` 优先于 `-C`，两者优先于 `-A/-B`
- [ ] 支持 `-n`，content 模式默认显示行号
- [ ] 支持 `-i` 大小写不敏感搜索
- [ ] 支持 `type` 转换为 `rg --type`
- [ ] 支持 `head_limit`、`offset` 分页，`head_limit: 0` 表示不限制
- [ ] 支持 `multiline` 转换为 `-U --multiline-dotall`
- [ ] `pattern` 以 `-` 开头时使用 `-e pattern`
- [ ] `glob` 支持空格拆分、逗号拆分和 brace pattern 保留
- [ ] `files_with_matches` 在测试环境排序稳定

**Verification:**
- [ ] `bun test ./src/agent/tools/grep.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/agent/tools/grep.ts`
- `src/agent/tools/grep.test.ts`

**Estimated scope:** M

---

## Checkpoint 1: Tool 本体完成

- [ ] `GrepTool` 可以不经过 `AgentSession` 独立测试
- [ ] 三种输出模式均通过单元测试
- [ ] 没有新增依赖
- [ ] 没有引入 Claude Code 完整权限系统
- [ ] 搜索失败、无结果、不存在路径都有清晰反馈

---

## Phase 2: Agent Integration

### Task 3：注册 `GrepTool` 到 agent 默认工具

**Description:** 将 `GrepTool` 接入现有 agent tool registry 和 `AgentSession` 默认工具列表，让模型实际可以看到并调用 `Grep`。

**Acceptance criteria:**
- [ ] `src/agent/tools/index.ts` 导出 `createGrepTool`
- [ ] `src/agent/session.ts` 默认 tools 包含 `createGrepTool(options.cwd)`
- [ ] 默认 `AgentSession` 的 `tools` 中包含名称为 `Grep` 的 tool
- [ ] LLM payload conversion 能通过现有 `name/description/input_schema` 暴露 `Grep`
- [ ] 现有 `using-your-tools` 和 `Bash` description 中关于 `Grep` 的提示与实际工具一致

**Verification:**
- [ ] `bun test ./src/agent/session.test.ts`
- [ ] `bun test ./src/agent/tools/grep.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/agent/tools/index.ts`
- `src/agent/session.ts`
- `src/agent/session.test.ts`

**Estimated scope:** S

---

## Checkpoint 2: Agent 可调用

- [ ] `AgentSession` 默认工具列表包含 `Grep`
- [ ] 现有 session 测试通过
- [ ] 手动或测试确认 tool schema 可进入 LLM payload
- [ ] `Bash` 不再是内容搜索的唯一可行路径

---

## Phase 3: TUI Search Result Rendering

### Task 4：打通 `search_result` renderData 数据链

**Description:** 扩展 agent render data 类型，并修复当前 TUI hook 丢失 `renderData` 的问题，使 `GrepTool.renderResult()` 能一路传递到 `MessageItem`。

**Acceptance criteria:**
- [ ] `ToolRenderResult` 新增 `search_result` 类型
- [ ] `GrepTool.renderResult()` 返回 `search_result`
- [ ] `src/tui/hooks/useAgent.ts` 在 `tool_end` 消息中保留 `event.renderData`
- [ ] 现有 `plain` 和 `structured_diff` renderData 行为不回退

**Verification:**
- [ ] 增加或更新测试覆盖 `tool_end` renderData passthrough
- [ ] `bun test` 中相关 TUI/session 测试通过

**Dependencies:** Task 1

**Files likely touched:**
- `src/agent/types.ts`
- `src/agent/tools/grep.ts`
- `src/tui/hooks/useAgent.ts`
- `src/tui/types.ts`

**Estimated scope:** M

---

### Task 5：实现 TUI 搜索结果展示

**Description:** 在 `MessageItem.tsx` 中支持 `search_result`，提供摘要和详细内容展示。目标是让 TUI 用户能看懂搜索结果规模和内容，同时避免默认刷屏。

**Acceptance criteria:**
- [ ] `files_with_matches` 显示 `Found N files` 和文件列表
- [ ] `content` 显示 `Found N lines` 和匹配内容
- [ ] `count` 显示 `Found X matches across Y files` 和 `file:count` 内容
- [ ] 错误结果继续走现有 error summary 路径
- [ ] 输出在终端中保持可读，不影响其他 message 类型

**Verification:**
- [ ] `bun test ./src/tui/components/MessageItem.integration.test.tsx`

**Dependencies:** Task 4

**Files likely touched:**
- `src/tui/components/MessageItem.tsx`
- `src/tui/components/MessageItem.integration.test.tsx`

**Estimated scope:** S

---

## Checkpoint 3: TUI 展示完成

- [ ] `Grep` tool result 同时满足 LLM 和 TUI 展示
- [ ] TUI 能显示三种 `output_mode` 的摘要和详情
- [ ] 手动 `bun run tui` 搜索一次，确认 agent 能调用 `Grep`
- [ ] 未改变 `Read`、`Write`、`Edit`、`WebFetch` 等现有展示行为

---

## Phase 4: Regression

### Task 6：回归验证与 spec 同步

**Description:** 运行完整测试和类型检查。如果实现中发现 spec 范围需要微调，先同步 spec/plan，再继续实现或交付。

**Acceptance criteria:**
- [ ] `bun test` 通过
- [ ] `bun run typecheck` 通过
- [ ] 如发现实现与 spec 不一致，已更新 `docs/ys-powers/specs/2026-05-02-grep-tool-alignment-design.md`
- [ ] 手动 TUI 验证结果记录在最终说明中

**Verification:**
- [ ] `bun test`
- [ ] `bun run typecheck`
- [ ] `bun run tui`

**Dependencies:** Tasks 1-5

**Files likely touched:**
- `docs/ys-powers/specs/2026-05-02-grep-tool-alignment-design.md`（仅当范围变化）
- `docs/ys-powers/plans/2026-05-02-grep-tool-alignment.md`（仅当任务变化）

**Estimated scope:** S

---

## 风险与缓解

| Risk | Impact | Mitigation |
|---|---|---|
| 系统没有安装 `rg` | High | 第一版按 spec 依赖系统 `rg`，错误信息必须清晰；后续单独设计 ripgrep resolver |
| `rg` 输出量过大污染上下文 | Medium | 默认 `head_limit = 250`，使用 `--max-columns 500`，并支持分页 |
| TUI 展开交互与 CC 不完全一致 | Medium | 第一版保证摘要和详情展示；精确 `Ctrl+O` 交互后续单独设计 |
| `Glob` 当前使用 `--no-ignore`，与 Grep 安全边界不同 | Medium | `Grep` 不照搬 `Glob` 参数，按本 spec 默认排除大目录和 VCS 目录 |
| TypeBox 对 `-A`/`-B` 这类字段的类型和调用不直观 | Low | 用测试覆盖 schema、参数校验和实际执行路径 |

## 并行化机会

- Task 1 和 Task 2 应顺序执行，因为 Task 2 依赖基础 `GrepTool`。
- Task 3 可在 Task 1 完成后独立进行，不必等待 Task 2 的全部边界测试。
- Task 4 和 Task 5 应顺序执行，因为 UI 渲染依赖 `search_result` 类型。
- GrepTool 单测补充和 TUI 组件测试可由不同会话并行推进，但需要先固定 `GrepOutput` / `search_result` 契约。

## Open Questions

- 是否需要后续独立实现 `ripgrep` resolver，支持 system/vendor/embedded 三层选择？
- 是否需要后续精确复刻 Claude Code 的 `Ctrl+O` per-message 展开体验？
