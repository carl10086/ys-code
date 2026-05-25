# Plan: TodoWrite Tool CC 对齐改进

## 依赖分析

```
P1-1 (TUI 渲染) ──依赖──> P1-2 (renderData 持久化) ──依赖──> 类型扩展
                                               │
                                               └──> tool-execution 写入

P2-4 (Description/Prompt 分离) ──独立──> AgentTool 扩展
                                │
                                └──> system-prompt section 注册
```

**关键依赖：**
- `MessageItem.tsx` 的 `todo_list` 渲染依赖 `deriveUIMessages` 正确传递 `renderData`
- `deriveUIMessages` 依赖 `ToolResultMessage` 携带 `renderData` 字段
- `ToolResultMessage` 字段扩展是 P1 的基础，必须先完成
- P2-4 与 P1 无直接依赖，可独立实施，但建议 P1 完成后进行（避免同时修改多个核心类型）

## 垂直切片

### Slice 1: Todo 状态统计 TUI 展示与持久化（端到端）

**目标：** 让 todo 更新结果在终端可见，且 compact/恢复后状态不丢失。

**路径：**
1. `core/ai/types.ts` → 扩展 `ToolResultMessage`，新增 `renderData?: ToolRenderResult`
2. `agent/tool-execution.ts` → `emitToolCallOutcome` 将 `result.renderData` 写入 `ToolResultMessage`
3. `tui/hooks/useAgent.ts` → `deriveUIMessages` 中 `toolResult` 处理时传递 `renderData`
4. `tui/components/MessageItem.tsx` → `tool_end` 分支新增 `todo_list` 类型渲染
5. 测试覆盖

**验收标准：**
- `bun run typecheck` 通过
- `bun test` 通过
- 运行时执行 TodoWrite，终端显示任务统计（总数/进行中/完成数）
- compact 触发后，历史 todo 渲染状态不丢失

### Slice 2: Description/Prompt 分离（端到端）

**目标：** 将 tool schema 描述与 system prompt 指南分离，对齐 CC 的 `description()`/`prompt()` 架构。

**路径：**
1. `agent/types.ts` → `AgentTool` 接口新增 `prompt?: string` 字段
2. `agent/tools/todo-write.ts` → `description` 精简为 1 行摘要；新增 `prompt` 字段承载原长文本
3. `agent/system-prompt/sections/todo-write-prompt.ts` → 新增 section，读取 `context.tools` 中的 `TodoWrite` 的 `prompt` 并输出
4. `agent/system-prompt/coding-agent.ts` → 注册 `todo-write-prompt` section
5. 测试覆盖

**验收标准：**
- `bun run typecheck` 通过
- `bun test` 通过
- 运行时 system prompt 包含 todoWrite 的详细指导（原 `TODO_WRITE_DESCRIPTION` 的内容）
- `TodoWrite` 的 tool schema description 精简为 1 行

## 任务分解

### Task 1: 扩展 ToolResultMessage 类型
- **文件**: `src/core/ai/types.ts`
- **变更**: `ToolResultMessage` 接口新增 `renderData?: ToolRenderResult`
- **依赖**: 无
- **验收**: 类型编译通过
- **验证**: `bun run typecheck`

### Task 2: 更新 tool-execution 传递 renderData
- **文件**: `src/agent/tool-execution.ts`
- **变更**: `emitToolCallOutcome` 接收 `renderData` 并写入 `ToolResultMessage`
- **依赖**: Task 1
- **验收**: `ToolResultMessage` 包含 `renderData`
- **验证**: 检查源码逻辑 + 单元测试

### Task 3: 修复 deriveUIMessages 的 renderData 传递
- **文件**: `src/tui/hooks/useAgent.ts`
- **变更**: `toolResult` 处理时传递 `renderData` 而非硬编码 `undefined`
- **依赖**: Task 1
- **验收**: compact 后 UI 重建保留 `renderData`
- **验证**: 单元测试（模拟 compact 场景）

### Task 4: MessageItem 新增 todo_list 渲染
- **文件**: `src/tui/components/MessageItem.tsx`
- **变更**: `tool_end` 分支新增 `renderData.type === "todo_list"` 处理
- **依赖**: Task 3
- **验收**: 终端显示任务状态统计
- **验证**: 运行时测试 + 截图确认

### Task 5: 扩展 AgentTool 接口
- **文件**: `src/agent/types.ts`
- **变更**: `AgentTool` 新增 `prompt?: string`
- **依赖**: 无（可与 Task 1 并行）
- **验收**: 类型编译通过
- **验证**: `bun run typecheck`

### Task 6: 拆分 todo-write 的 description 与 prompt
- **文件**: `src/agent/tools/todo-write.ts`
- **变更**: `description` 精简；新增 `prompt` 字段
- **依赖**: Task 5
- **验收**: description 为 1 行，prompt 包含完整指南
- **验证**: 检查源码

### Task 7: 创建 todo-write-prompt system prompt section
- **文件**: `src/agent/system-prompt/sections/todo-write-prompt.ts`（新建）
- **变更**: 遍历 `context.tools`，找到 `TodoWrite`，输出其 `prompt`
- **依赖**: Task 5
- **验收**: section 正确输出 prompt 内容
- **验证**: 单元测试

### Task 8: 注册 todo-write-prompt section
- **文件**: `src/agent/system-prompt/coding-agent.ts`
- **变更**: `sections` 数组新增 `todo-write-prompt`
- **依赖**: Task 7
- **验收**: system prompt 构建时包含该 section
- **验证**: 运行时检查 system prompt 输出

### Task 9: 回归测试与运行时验证
- **文件**: 多个测试文件
- **变更**: 更新现有测试，确保无回归
- **依赖**: Task 4 和 Task 8 完成
- **验收**: 所有测试通过，运行时表现符合预期
- **验证**: `bun test` + 手动运行

## 检查点

**Checkpoint 1（Slice 1 完成）:**
- `ToolResultMessage` 已扩展
- `emitToolCallOutcome` 传递 `renderData`
- `deriveUIMessages` 保留 `renderData`
- `MessageItem` 渲染 `todo_list`
- **验证命令**: `bun test` + 手动运行确认终端输出

**Checkpoint 2（Slice 2 完成）:**
- `AgentTool` 已扩展 `prompt`
- `todo-write.ts` 完成拆分
- `todo-write-prompt.ts` 已创建并注册
- **验证命令**: `bun test` + 运行时检查 system prompt 内容

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| `ToolResultMessage` 类型扩展影响其他模块 | 中 | 中 | 限制为可选字段，保持向后兼容 |
| `AgentTool` 新增字段影响现有工具定义 | 低 | 低 | `prompt` 为可选字段，不影响现有工具 |
| `MessageItem` 渲染引入 UI 回归 | 低 | 低 | 保持现有分支不变，仅新增分支 |
| System prompt section 注册导致 prompt 过长 | 低 | 中 | section 仅在 `TodoWrite` 存在时输出内容 |

## 备注

- 所有变更保持向后兼容：新增字段均为可选（`?`）
- 不修改 `todoStore` 核心语义（全量覆盖、全 completed 清空）
- 不删除现有的 `TODO_WRITE_DESCRIPTION` 常量（保留用于兼容）
- `using-your-tools.ts` 保持独立，不混入 tool-specific guidance（由独立 section 负责）
