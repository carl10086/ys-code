# Implementation Plan: TodoWrite Tool

## Overview

在 ys-code 中实现一个对齐 Claude Code 的 `TodoWrite` 工具：模型可通过该工具维护一份会话任务清单，TUI 以常驻面板展示进度。本次范围限定 **B 档**（工具骨架 + TUI 渲染），不实现持久化、不实现 sub-agent 分桶、不实现 verificationNudge。

## Architecture Decisions

- **状态存放**：独立 `TodoStore` class（in-memory + 订阅模式），由 `createTodoWriteTool(store)` 工厂注入；TUI 通过 `AgentSession.subscribe` 监听 `todo_update` 事件。
- **写语义**：完全照搬 cc —— 全量覆盖（无增量 API）+ 全 `completed` 自动清空（store 内部清空，但向 LLM 返回的 `newTodos` 是用户原始提交值）。
- **Prompt**：完全照搬 cc 的 `PROMPT` / `DESCRIPTION` / 工具结果固定文本，保最大模型默契。`${FILE_EDIT_TOOL_NAME}` 插值替换为硬编码 `"Edit"`。
- **TUI**：常驻 `<TodoPanel>` 面板，插在 `MessageList` 与 `StatusBar` 之间；空列表 `return null` 不占位；工具调用结果框内不渲染（让面板独占展示）。
- **生命周期**：纯 in-memory，session 进程内有效；`session.reset()` 同步清空 store；不写盘。

## Reference Files

执行任务前必读这些位置：

**ys-code 现有模式**：
- `src/agent/define-agent-tool.ts` — `defineAgentTool` helper
- `src/agent/types.ts:44-173` — `ToolRenderResult` / `AgentTool` / `ToolUseContext` 接口
- `src/agent/tools/webfetch.ts` — 无 cwd 依赖的工具工厂样例
- `src/agent/tools/webfetch.test.ts` — 工具单测 mock 模式
- `src/agent/file-state.ts` — 独立 class + 事件订阅风格参考
- `src/agent/session.ts:36-42` — `AgentSessionEvent` 联合类型
- `src/agent/session.ts:121-189` — `AgentSession` 构造与工具注册
- `src/agent/session.ts:452-457` — `reset` 实现
- `src/agent/tools/index.ts` — 工具导出汇总
- `src/tui/app.tsx:111-115` — 布局插入点
- `src/tui/components/StatusBar.tsx` — Ink 紧凑面板风格
- `src/tui/components/PromptInput.test.tsx` — `ink-testing-library` 用法
- `src/tui/hooks/useAgent.ts` — session 事件 → React state 转换

**cc 参考（必须照搬，不要重写）**：
- `refer/claude-code-haha/src/tools/TodoWriteTool/prompt.ts` — `PROMPT` 与 `DESCRIPTION` 常量原文
- `refer/claude-code-haha/src/tools/TodoWriteTool/TodoWriteTool.ts:104-114` — 工具结果固定文本（中间 `verificationNudge` 部分忽略，只保留 `base` 文本）
- `refer/claude-code-haha/src/utils/todo/types.ts` — schema 结构

## Task List

### Phase 1：数据层

#### Task 1: 实现 TodoStore 与类型

**Description:** 在 `src/agent/todo/` 下新增 schema、类型、`TodoStore` 类与单测。

**Files:**
- `src/agent/todo/types.ts`
- `src/agent/todo/store.ts`
- `src/agent/todo/store.test.ts`

**Acceptance criteria:**
- [ ] `TodoItemSchema` 用 TypeBox 定义，校验 `content` / `status` / `activeForm`；`status` 限定 `pending` / `in_progress` / `completed`
- [ ] `TodoStore.set(next)` 全量覆盖；当 `next.length > 0 && next.every(t => t.status === "completed")` 时内部 todos 清空
- [ ] `TodoStore.set()` 返回 `{ oldTodos, newTodos }`，其中 `newTodos` 是用户**原始提交值**（不是清空后的版本）
- [ ] `TodoStore.get()` 返回拷贝（外部 mutate 不影响内部）
- [ ] `TodoStore.subscribe(fn)` 在 set 后触发；事件中 `newTodos` 等于内部 todos（清空后的值）
- [ ] `TodoStore.reset()` 等价于 `set([])`

**Verification:**
- [ ] `bun test src/agent/todo/` 全绿
- [ ] `bun run typecheck` 通过

**Dependencies:** None
**Size:** S (3 files)

---

### Checkpoint C1（T1 后）
- [ ] todo 层单测全绿
- [ ] 类型导出可被外部 import

---

### Phase 2：工具集成

#### Task 2: 实现 TodoWriteTool

**Description:** 在 `src/agent/tools/` 下新增 `TodoWriteTool` 工具与单测。Prompt 与固定结果文本完全照搬 cc。

**Files:**
- `src/agent/tools/todo-write.ts`
- `src/agent/tools/todo-write.test.ts`

**Acceptance criteria:**
- [ ] 导出 `createTodoWriteTool(store: TodoStore): AgentTool<...>` 工厂
- [ ] 工具元数据：`name === "TodoWrite"`、`label === "TodoWrite"`、`isReadOnly === false`、`isConcurrencySafe === false`、`isDestructive === false`
- [ ] `inputSchema = { todos: TodoListSchema }`；`outputSchema = { oldTodos, newTodos }`
- [ ] `execute` 调用 `store.set(params.todos)` 并返回结果
- [ ] `formatResult` 返回 cc 的固定文本（一字不改）:
  `"Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable"`
- [ ] `renderResult` 返回 `{ type: "todo_list", oldTodos, newTodos }`
- [ ] `description` 是 cc 的 `DESCRIPTION` 原文
- [ ] 工具描述（运行时返回给 LLM 的 prompt）是 cc `PROMPT` 原文，`${FILE_EDIT_TOOL_NAME}` 替换为硬编码 `"Edit"`
- [ ] 单测断言 prompt 字符串不含 `${`（防止插值变量遗漏）

**Verification:**
- [ ] `bun test src/agent/tools/todo-write.test.ts` 全绿
- [ ] `bun run typecheck` 通过

**Dependencies:** T1
**Size:** M (2 files；prompt 文本约 180 行)

---

#### Task 3: AgentSession 集成与类型扩展

**Description:** 把 `TodoWriteTool` 接入 `AgentSession`，扩展 `ToolRenderResult` 与 `AgentSessionEvent` 联合类型，新增 todo 事件转发，reset 同步清空 store。

**Files:**
- `src/agent/types.ts`
- `src/agent/session.ts`
- `src/agent/tools/index.ts`

**Acceptance criteria:**
- [ ] `ToolRenderResult` 联合加 `{ type: "todo_list"; oldTodos: TodoList; newTodos: TodoList }`
- [ ] `AgentSessionEvent` 联合加 `{ type: "todo_update"; oldTodos: TodoList; newTodos: TodoList }`
- [ ] `AgentSession` 构造器内 `new TodoStore()`，注册 `createTodoWriteTool(store)` 到默认工具列表
- [ ] `AgentSession.subscribe` 接收的 listener 在 todo 变化时收到 `todo_update` 事件
- [ ] `AgentSession.reset()` 调用 `store.reset()`
- [ ] 新增 `get todos(): TodoList` getter（返回 store 拷贝）
- [ ] `src/agent/tools/index.ts` 导出 `createTodoWriteTool`

**Verification:**
- [ ] `bun test src/agent/session.test.ts` 通过
- [ ] `bun test` 整套通过（无回归）
- [ ] `bun run typecheck` 通过

**Dependencies:** T2
**Size:** S (3 files)

---

### Checkpoint C2（T3 后）
- [ ] 整套测试绿
- [ ] typecheck 绿
- [ ] 通过 `session.subscribe(e => ...)` 可观察到 `todo_update` 事件（用 smoke 测试或临时 console.log 验证）

---

### Phase 3：TUI

#### Task 4: TodoPanel 组件

**Description:** 新增常驻 TUI 面板组件，根据 todo 列表渲染。

**Files:**
- `src/tui/components/TodoPanel.tsx`
- `src/tui/components/TodoPanel.test.tsx`

**Acceptance criteria:**
- [ ] 接收 props `{ todos: TodoList }`
- [ ] 空列表 `todos.length === 0` 时返回 `null`
- [ ] 状态符号：`pending` → `☐`（gray），`in_progress` → `◐`（yellow bold），`completed` → `☑`（green dim）
- [ ] `in_progress` 项显示 `activeForm` 替代 `content`
- [ ] 标题行：`──── Tasks (n_completed/total) ────`
- [ ] 单测覆盖：空列表不渲染、三种状态各一例、in_progress 显示 `activeForm` 而非 `content`

**Verification:**
- [ ] `bun test src/tui/components/TodoPanel.test.tsx` 全绿
- [ ] `bun run typecheck` 通过

**Dependencies:** T1（用 `TodoList` 类型）
**Size:** S (2 files)

---

#### Task 5: app.tsx 挂载与 hook 集成

**Description:** 在 `useAgent` hook 中订阅 `todo_update`，在 `app.tsx` 中挂载 `<TodoPanel>`。

**Files:**
- `src/tui/hooks/useAgent.ts`
- `src/tui/app.tsx`

**Acceptance criteria:**
- [ ] `useAgent` 暴露 `todos: TodoList`，初值 = `session.todos`，订阅 `todo_update` 自动刷新
- [ ] `app.tsx` 在 `<MessageList>` 与 `<StatusBar>` 之间渲染 `<TodoPanel todos={todos} />`
- [ ] hook 卸载时清理订阅

**Verification:**
- [ ] `bun test src/tui/hooks/useAgent.test.ts` 通过（如需补单测验证 todos 订阅）
- [ ] `bun run typecheck` 通过
- [ ] **手测**：`bun start` → 在 REPL 中触发模型调用 `TodoWrite` → 面板出现 → 状态切换颜色刷新 → 全 `completed` 后面板消失 → `/reset` 后面板消失

**Dependencies:** T3, T4
**Size:** S (2 files)

---

### Checkpoint C3（T5 后）
- [ ] 整套测试绿
- [ ] typecheck 绿
- [ ] 手测三种状态变化 + 全 completed 自动消失 + reset 后消失
- [ ] 准备 PR review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 照搬 cc PROMPT 时 `${FILE_EDIT_TOOL_NAME}` 插值遗漏 | Medium | T2 单测断言 prompt 不含 `${` |
| `TodoStore.set()` 返回值 vs 内部状态混淆（全 completed 时） | Medium | T1 单测两条专门用例覆盖 |
| `ToolRenderResult` 联合扩展破坏其他工具的 render 类型断言 | Low | T3 跑 `bun run typecheck` 验证 |
| 面板挤压 `MessageList` 视觉空间 | Low | 空列表 `return null`；有列表也仅占 N+1 行 |

## Open Questions

无（前置 explore-then-ask 已收敛）。
