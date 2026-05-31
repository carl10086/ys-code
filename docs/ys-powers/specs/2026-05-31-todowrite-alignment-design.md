# TodoWrite Task 对齐设计

## 目标

对齐 `claude-code-haha`（CC）的 TodoWrite 工具实现，提升 YS 在 system prompt 引导、verification nudge 和 TUI 渲染三个层面的功能完整性。

## 背景

基于 2026-05-31 的 CC Diff 分析，YS 的 TodoWrite 实现与 CC 存在以下核心差距：

1. **System Prompt 缺少 TodoWrite 引导**（P0）：CC 在 `# Using your tools` section 中明确引导模型使用 TodoWrite 管理任务，YS 缺失此引导。
2. **缺少 Verification Nudge**（P2）：CC 在关闭 3+ 任务且无 verification step 时，在 tool result 中附加 nudge 提醒，YS 无此逻辑。
3. **TUI 渲染简陋**：YS 的 TodoPanel 仅使用简单边框和文本符号，缺乏进度条、颜色层次、编号等视觉元素。

## 设计决策

### 1. System Prompt 引导（P0）

**方案：在 `using-your-tools.ts` 中动态检测 TodoWrite 并注入引导**

参考 CC 的 `getUsingYourToolsSection` 实现：

```ts
const hasTodoWrite = context.tools.some((tool) => tool.name === "TodoWrite");
```

当检测到 TodoWrite 存在时，在 `# Using your tools` section 末尾追加：

```
- Break down and manage your work with the TodoWrite tool. This tool is helpful for planning your work and helping the user track your progress. Mark each task as completed as soon as you are done with the task. Do not batch up multiple tasks before marking them as completed.
```

**与 CC 的差异说明**：
- CC 支持 TodoWrite 和 TaskCreate 两套任务工具（V1/V2），YS 目前只有 TodoWrite，因此简化为单一检测。

**涉及文件**：
- `src/agent/system-prompt/sections/using-your-tools.ts`

### 2. Verification Nudge（P2）

**方案：在 TodoWrite 输出中增加 `verificationNudgeNeeded` 字段**

**触发条件**（对齐 CC 逻辑，简化 feature gate）：
1. 所有任务状态为 `completed`
2. 任务数量 >= 3
3. 没有任何任务的 `content` 匹配 `/verif/i`

**输出 Schema 变更**：

```ts
const outputSchema = Type.Object({
  oldTodos: Type.Array(TodoItemSchema),
  newTodos: Type.Array(TodoItemSchema),
  verificationNudgeNeeded: Type.Boolean({ default: false }),
});
```

**Tool Result 文本**：

基础文本（保持不变）：
```
Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable
```

当 `verificationNudgeNeeded === true` 时追加：
```

NOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, verify your work independently — you cannot self-assign PARTIAL by listing caveats in your summary.
```

**与 CC 的差异说明**：
- CC 的 nudge 文本包含具体的 `subagent_type="verification_agent"` 引用，YS 目前无 verification agent，因此简化为通用提醒。
- CC 有 feature gate（`feature('VERIFICATION_AGENT')` + GrowthBook flag），YS 暂不引入 feature gate。

**涉及文件**：
- `src/agent/tools/todo-write.ts`
- `src/agent/tools/todo-write.test.ts`

### 3. TUI 样式改进

**当前问题**：

```
┌────────────────────────┐
│ Tasks (1/3)            │
│ ☐ task A               │
│ ◐ task B               │
│ ☑ task C               │
└────────────────────────┘
```

**改进方案**（分阶段）：

#### Phase 1: 基础美化（本次实现）

1. **任务编号**：为每个任务添加序号，便于引用
2. **进度条**：在标题下方增加 ASCII 进度条，直观显示完成比例
3. **颜色层次**：
   - 标题：`dimColor`
   - pending：`gray`
   - in_progress：`yellow` + `bold`
   - completed：`green` + `dimColor`（已完成的不突出）
4. **符号统一**：使用更清晰的 Unicode 符号
   - pending：`○`
   - in_progress：`◐`
   - completed：`●`

预期效果：
```
╭── Tasks 2/3 ───────────────────────╮
│ [████████░░░░░░░░░░] 67%           │
│ ○ 1. Fix auth bug                  │
│ ◐ 2. Running tests                 │
│ ● 3. Update docs                   │
╰────────────────────────────────────╯
```

#### Phase 2: 交互增强（后续迭代）

- 支持任务折叠/展开
- 支持任务详情查看（hover 显示 description）
- 与 tool_end 的 `renderData` 联动，在消息流中渲染 todo diff（新增/删除/状态变更高亮）

**涉及文件**：
- `src/tui/components/TodoPanel.tsx`

## 测试策略

### 单元测试

1. **`todo-write.test.ts`**：
   - 验证 `verificationNudgeNeeded` 在 3+ completed 且无 verification step 时为 `true`
   - 验证 `verificationNudgeNeeded` 在包含 "verify" 字样时为 `false`
   - 验证 `formatResult` 在 nudge 触发时包含 nudge 文本

2. **`using-your-tools.test.ts`**（如存在）：
   - 验证当 tools 包含 TodoWrite 时，system prompt 包含引导文本
   - 验证当 tools 不包含 TodoWrite 时，system prompt 不包含引导文本

### 集成测试

1. **`todo-write.test.ts`**（已有的集成测试）：
   - 验证 execute 返回的 `verificationNudgeNeeded` 字段正确性

### 视觉验证

1. 启动 TUI，触发 TodoWrite 调用，验证 TodoPanel 渲染效果
2. 验证不同任务状态（pending/in_progress/completed）的颜色和符号正确

## 边界与约束

### 本次不做（明确排除）

1. **TodoStore 多 agent 隔离**：YS 尚未支持 subagent，等 subagent 实现后再引入。
2. **Deferred loading / strict mode**：YS 工具框架层暂不支持，等框架升级后统一引入。
3. **Task V2 工具**：CC 有 TaskCreate/TaskGet/TaskUpdate/TaskList 作为 TodoWrite 的替代，YS 暂不需要。
4. **Verification Agent 完整流程**：仅实现 nudge 文本，不实现 verification agent 调用逻辑。

### 必须遵守

1. **Prompt 文本保持与 CC 一致**：system prompt 中的 TodoWrite 引导文本必须与 CC 逐字一致（除工具名引用外）。
2. **FIXED_RESULT_TEXT 保持不变**：返回 LLM 的基础结果文本不得修改。
3. **Store 清空语义不变**：全 completed 时内部状态自动清空的行为必须保持。

## 验收标准

- [ ] `using-your-tools.ts` 在 tools 包含 TodoWrite 时输出引导文本
- [ ] `todo-write.ts` 的 `outputSchema` 包含 `verificationNudgeNeeded`
- [ ] 3+ completed 且无 verification step 时，`formatResult` 输出包含 nudge
- [ ] `TodoPanel.tsx` 渲染包含进度条、编号、颜色层次
- [ ] 所有现有测试通过，新增测试通过

## 涉及的文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/agent/system-prompt/sections/using-your-tools.ts` | 修改 | 增加 TodoWrite 引导检测 |
| `src/agent/tools/todo-write.ts` | 修改 | 增加 verificationNudgeNeeded |
| `src/agent/tools/todo-write.test.ts` | 修改 | 增加 nudge 相关测试 |
| `src/tui/components/TodoPanel.tsx` | 修改 | 美化渲染样式 |
