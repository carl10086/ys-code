# TodoWrite Task 对齐 — 实施计划

## 依赖关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                         三个独立垂直切片                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  切片 A: System Prompt 引导                无依赖                │
│  ├── using-your-tools.ts (修改)                                 │
│  └── 验证: system prompt 输出检查                                 │
│                                                                 │
│  切片 B: Verification Nudge                无依赖                │
│  ├── todo-write.ts (修改: schema + execute + formatResult)       │
│  ├── todo-write.test.ts (新增测试)                               │
│  └── 验证: 测试通过 + 手动触发检查                                  │
│                                                                 │
│  切片 C: TUI 美化                          无依赖                │
│  ├── TodoPanel.tsx (修改: 进度条 + 编号 + 颜色)                   │
│  └── 验证: 启动 TUI 视觉检查                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**关键结论**：三个切片完全独立，无交叉依赖，可任意顺序执行或并行开发。

---

## 垂直切片任务

### 任务 1: System Prompt TodoWrite 引导（P0）

**目标**：在 `# Using your tools` system prompt section 中动态注入 TodoWrite 使用引导。

**改动文件**：
- `src/agent/system-prompt/sections/using-your-tools.ts`

**实施步骤**：
1. 在 `compute` 函数中检测 `context.tools` 是否包含 `name === "TodoWrite"` 的工具
2. 若存在，在 lines 数组中插入 CC 对齐的引导文本：
   ```
   Break down and manage your work with the TodoWrite tool. This tool is helpful for planning your work and helping the user track your progress. Mark each task as completed as soon as you are done with the task. Do not batch up multiple tasks before marking them as completed.
   ```

**验收标准**：
- [ ] `context.tools` 包含 TodoWrite 时，输出包含上述引导文本
- [ ] `context.tools` 不包含 TodoWrite 时，输出不包含引导文本
- [ ] `context.tools.length === 0` 时，返回空字符串（保持现有行为）

**验证步骤**：
1. 运行 `bun test` 检查 system prompt 相关测试（如有）
2. 临时在 `coding-agent.ts` 中打印 system prompt，确认引导文本出现位置正确

---

### 任务 2: TodoWrite Verification Nudge（P2）

**目标**：在关闭 3+ 任务且无 verification step 时，在 tool result 中附加 verification nudge。

**改动文件**：
- `src/agent/tools/todo-write.ts`
- `src/agent/tools/todo-write.test.ts`

**实施步骤**：
1. **修改 `outputSchema`**：增加 `verificationNudgeNeeded: Type.Boolean({ default: false })`
2. **修改 `execute`**：
   - 在 `store.set()` 后计算 `allDone = params.todos.length > 0 && params.todos.every(t => t.status === "completed")`
   - 计算 `verificationNudgeNeeded = allDone && params.todos.length >= 3 && !params.todos.some(t => /verif/i.test(t.content))`
   - 返回对象包含 `verificationNudgeNeeded`
3. **修改 `formatResult`**：
   - 接收 `output` 参数（当前签名 `() => ...` 忽略参数，需改为 `(output) => ...`）
   - 基础文本保持 `FIXED_RESULT_TEXT`
   - `output.verificationNudgeNeeded === true` 时追加 nudge 文本
4. **更新测试**：
   - 现有测试：断言新增 `verificationNudgeNeeded` 字段值
   - 新增测试 A：`3+ completed` + 无 `verif` → `verificationNudgeNeeded === true`
   - 新增测试 B：`3+ completed` + 含 `verif` → `verificationNudgeNeeded === false`
   - 新增测试 C：`< 3 completed` → `verificationNudgeNeeded === false`
   - 新增测试 D：nudge 触发时 `formatResult` 输出包含 nudge 文本

**验收标准**：
- [ ] `outputSchema` 包含 `verificationNudgeNeeded: boolean`
- [ ] 3+ completed 且无 verification step 时，`execute` 返回 `verificationNudgeNeeded: true`
- [ ] 包含 verification step（`/verif/i` 匹配）时，`execute` 返回 `verificationNudgeNeeded: false`
- [ ] `< 3` 个任务 completed 时，`execute` 返回 `verificationNudgeNeeded: false`
- [ ] `formatResult` 在 nudge 触发时输出包含 `NOTE: You just closed out 3+ tasks...`
- [ ] 所有现有测试通过
- [ ] 新增测试通过

**验证步骤**：
1. `bun test src/agent/tools/todo-write.test.ts`
2. 检查 `formatResult` 输出格式

---

### 任务 3: TodoPanel TUI 美化

**目标**：改进 TodoPanel 的视觉呈现，增加进度条、任务编号、颜色层次。

**改动文件**：
- `src/tui/components/TodoPanel.tsx`

**实施步骤**：
1. **进度条组件**：
   - 计算 `completedCount / todos.length`
   - 渲染 ASCII 进度条（如 `[████████░░░░░░░░░░] 67%`）
   - 进度条宽度固定（如 20 个字符）
2. **任务编号**：
   - 在 `todos.map()` 中使用 `index + 1` 作为序号前缀
3. **颜色层次调整**：
   - pending：`gray`（当前 `white` → 更低调）
   - in_progress：`yellow` + `bold`（当前仅 `yellow` → 突出正在执行）
   - completed：`green` + `dimColor`（当前仅 `green` → 已完成的不抢注意力）
4. **符号统一**：
   - pending：`○`（空心圆）
   - in_progress：`◐`（半圆）
   - completed：`●`（实心圆）
5. **标题栏**：
   - 改为 `Tasks {completedCount}/{totalCount}` 格式
   - 使用 `dimColor`

**验收标准**：
- [ ] 进度条正确显示完成百分比
- [ ] 每个任务前有递增编号（1, 2, 3...）
- [ ] pending 任务显示为 gray
- [ ] in_progress 任务显示为 yellow + bold
- [ ] completed 任务显示为 green + dimColor
- [ ] 空列表时返回 `null`（保持现有行为）
- [ ] TUI 启动后视觉检查通过

**验证步骤**：
1. 启动 TUI (`bun run start` 或等效命令)
2. 触发 TodoWrite 调用（或手动构造 todo_update 事件）
3. 检查面板渲染效果

---

## 检查点

| 检查点 | 触发条件 | 验证内容 |
|--------|---------|---------|
| CP-1 | 任务 1 完成 | `using-your-tools.ts` 输出正确，system prompt 包含引导 |
| CP-2 | 任务 2 完成 | `bun test src/agent/tools/todo-write.test.ts` 全部通过 |
| CP-3 | 任务 3 完成 | TUI 启动，TodoPanel 视觉检查通过 |
| CP-4 | 全部完成 | `bun test` 全量通过，无回归 |

---

## 风险与回退

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| formatResult 签名变更导致调用方类型错误 | 编译失败 | TypeBox schema 变更会触发类型检查，编译通过即安全 |
| TodoPanel 新符号在某些终端显示为乱码 | 视觉降级 | 使用常见 Unicode 符号（○◐●），Ink 自动处理不支持的环境 |
| System prompt 文本过长 | 提示词膨胀 | 仅增加一行引导文本，影响极小 |

## 回退策略

任一任务出现问题可独立回退：
- 任务 1：删除 `using-your-tools.ts` 中的 TodoWrite 引导行
- 任务 2：回滚 `todo-write.ts` 到修改前版本
- 任务 3：回滚 `TodoPanel.tsx` 到修改前版本
