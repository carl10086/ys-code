# Spec: TodoWrite Tool CC 对齐改进

## Objective

对齐 `claude-code-haha` (CC) 的 `TodoWriteTool` 实现模式，提升 ys-code 的 TodoWrite 工具在 TUI 渲染、消息持久化和 system prompt 架构上的一致性。

当前 `todoWrite` 工具已具备基础功能（创建、更新、追踪任务列表），但存在以下差距：

1. **TUI 渲染缺失**: `tool_end` 的 `todo_list` 类型 `renderData` 在 `MessageItem.tsx` 中无渲染分支，导致 todo 更新结果在终端不可见
2. **消息持久化断层**: `deriveUIMessages` 重建 UI 消息时，`toolResult` 的 `renderData` 被硬编码为 `undefined`，导致 compact/恢复后 todo 渲染状态丢失
3. **描述与 Prompt 耦合**: `TODO_WRITE_DESCRIPTION` 同时承担 tool schema 描述（~1 行）和 system prompt 指南（180+ 行），违反单一职责

## Success Criteria

- [ ] `MessageItem.tsx` 的 `tool_end` 分支新增 `todo_list` 渲染，显示任务总数、进行中数、完成数
- [ ] `ToolResultMessage` 携带 `renderData` 字段，`deriveUIMessages` 重建时正确传递
- [ ] `AgentTool` 接口新增 `prompt` 字段，`todo-write.ts` 拆分为 `description`（1 行）和 `prompt`（system prompt section）
- [ ] 新增 `todo-write-prompt.ts` system prompt section，由 `coding-agent.ts` 注册
- [ ] 所有变更配套单元测试，`bun test` 通过
- [ ] 运行时验证：实际使用 TodoWrite 工具，确认终端展示任务统计

## Tech Stack

- Bun + TypeScript（与现有项目一致）
- Ink + React（TUI 层）
- TypeBox（schema 定义）

## Commands

```bash
# 运行相关测试
bun test src/agent/tools/todo-write.test.ts
bun test src/tui/hooks/useAgent.test.ts  # 如存在
bun test

# 类型检查
bun run typecheck

# 运行应用验证
bun run dev
```

## Project Structure

变更涉及以下文件：

```
src/
  agent/
    types.ts                    # AgentTool 接口新增 prompt 字段
    todo/
      store.ts                  # 已有，无需变更
      types.ts                  # 已有，无需变更
    tools/
      todo-write.ts             # 拆分：仅保留 description + tool 定义
      todo-write.test.ts        # 更新测试
    system-prompt/
      coding-agent.ts           # 注册 todo-write-prompt section
      todo-write-prompt.ts      # 新增：从原 description 提取的 system prompt
  core/ai/
    types.ts                    # ToolResultMessage 新增 renderData 字段
  tui/
    components/
      MessageItem.tsx           # 新增 todo_list 渲染分支
    hooks/
      useAgent.ts               # deriveUIMessages 传递 renderData
```

## Code Style

- 遵循现有项目命名：kebab-case 文件名，camelCase 变量
- System prompt section 使用 `staticSection`（内容固定）
- TUI 渲染组件保持函数式、无状态
- TypeBox schema 与现有工具一致

## Testing Strategy

- **单元测试**: 每个新增/修改模块配套测试
  - `todo-write.test.ts`: 验证 description/prompt 分离、execute 行为不变
  - `MessageItem.test.tsx`: 验证 todo_list 渲染输出（如 Ink 测试框架可用）
  - `useAgent.test.ts`: 验证 deriveUIMessages 重建时 renderData 保留
- **集成测试**: 端到端运行 TodoWrite 工具，确认 TUI 输出包含任务统计
- **回归测试**: 确保现有工具（Bash、Read、Edit 等）不受 AgentTool 接口变更影响

## Boundaries

- **Always**: 
  - 运行 `bun test` 后再提交
  - 保持 `AgentTool` 接口向后兼容（prompt 为可选字段）
  - TUI 渲染保持简洁，不添加交互控件
- **Ask first**: 
  - 修改其他工具的 description/prompt 分离（超出本 scope）
  - 引入新的测试依赖
- **Never**: 
  - 修改 `todoStore` 的核心语义（全量覆盖、全 completed 清空）
  - 在 system prompt 中硬编码业务规则
  - 删除现有的 `TODO_WRITE_DESCRIPTION` 常量（保留用于兼容）

## Open Questions

1. `ToolResultMessage.renderData` 的类型定义是否需要泛型约束，还是使用 `ToolRenderResult | undefined`？
2. `deriveUIMessages` 的 `renderData` 传递是否需要深拷贝，还是引用传递即可？
3. `todo_list` 渲染的样式细节（颜色、缩进）是否有设计参考？

---

## Plan

### Phase 1: 基础设施扩展

1. **扩展 `ToolResultMessage`**: 在 `core/ai/types.ts` 新增 `renderData` 字段
2. **扩展 `AgentTool` 接口**: 在 `agent/types.ts` 新增 `prompt` 可选字段
3. **更新 `tool-execution.ts`**: `emitToolCallOutcome` 时将 `renderData` 写入 `ToolResultMessage`

### Phase 2: TUI 渲染增强

1. **MessageItem 新增 todo_list 分支**: 显示 `oldTodos` → `newTodos` 的状态变化（pending/in_progress/completed 计数）
2. **useAgent 修复 deriveUIMessages**: `toolResult` 重建时传递 `renderData`

### Phase 3: Description/Prompt 分离

1. **创建 `todo-write-prompt.ts`**: 从现有 `TODO_WRITE_DESCRIPTION` 提取 system prompt 内容
2. **精简 `todo-write.ts`**: description 保留为 1 行摘要
3. **注册 section**: 在 `coding-agent.ts` 的 sections 数组中新增 `todo-write-prompt`

### Phase 4: 测试与验证

1. 更新现有测试
2. 新增渲染测试
3. 运行时验证

## Tasks

- [ ] Task: 扩展 ToolResultMessage 和 AgentTool 类型定义
  - Acceptance: `core/ai/types.ts` 和 `agent/types.ts` 编译通过
  - Verify: `bun run typecheck`
  - Files: `src/core/ai/types.ts`, `src/agent/types.ts`

- [ ] Task: 更新 tool-execution 传递 renderData
  - Acceptance: `emitToolCallOutcome` 将 `renderData` 写入消息
  - Verify: 检查 `tool-execution.ts` 源码
  - Files: `src/agent/tool-execution.ts`

- [ ] Task: MessageItem 新增 todo_list 渲染
  - Acceptance: 终端显示 todo 状态统计（总数/进行中/完成）
  - Verify: 运行应用，执行 TodoWrite 工具
  - Files: `src/tui/components/MessageItem.tsx`

- [ ] Task: 修复 deriveUIMessages 的 renderData 传递
  - Acceptance: compact 后 todo 渲染状态不丢失
  - Verify: 单元测试 + 运行时验证
  - Files: `src/tui/hooks/useAgent.ts`

- [ ] Task: 创建 todo-write-prompt system prompt section
  - Acceptance: 从现有 description 提取的 prompt 内容完整
  - Verify: 检查 `todo-write-prompt.ts` 内容
  - Files: `src/agent/system-prompt/todo-write-prompt.ts`

- [ ] Task: 精简 todo-write.ts 并注册 prompt section
  - Acceptance: description 为 1 行，prompt 在 system prompt 中生效
  - Verify: 运行时检查 system prompt 内容
  - Files: `src/agent/tools/todo-write.ts`, `src/agent/system-prompt/coding-agent.ts`

- [ ] Task: 更新测试并验证
  - Acceptance: 所有测试通过，运行时 TUI 正确展示
  - Verify: `bun test` + 手动运行验证
  - Files: `src/agent/tools/todo-write.test.ts` 等
