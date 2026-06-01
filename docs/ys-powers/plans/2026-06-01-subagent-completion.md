# Subagent 功能补充完善计划

## 背景

Subagent 核心实现已完成（`createSubagent`、`AgentTool`、`session 注册`、`system prompt 注入`）。Spec review 发现测试覆盖存在缺口，且 spec 文档与实际实现存在偏差。本计划聚焦补充测试和修正文档。

## 依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│  Slice 4: Spec 文档修正                                       │
│  (更新 depth 机制、递归注册、错误策略、测试清单)               │
│  ├── 依赖: Slice 1, 2, 3 全部完成                              │
│  └── 产出: docs/ys-powers/specs/2026-06-01-subagent-design.md  │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Slice 1      │   │  Slice 2      │   │  Slice 3      │
│  Abort 测试   │   │  嵌套 E2E 测试 │   │  错误恢复测试  │
│  补充         │   │  补充         │   │  补充         │
└───────────────┘   └───────────────┘   └───────────────┘
```

Slice 1/2/3 互相独立，可并行。Slice 4 依赖前三项完成。

---

## 垂直切片任务

### Slice 1: AbortController 传播测试补充

**目标：** 验证父代理 abort 信号能正确传播到子代理，且监听器被清理。

**当前状态：** `agent-tool.test.ts` 已有一个测试使用 `new AbortController().signal`，但未验证信号传播行为。

**任务详情：**

1. 在 `src/agent/tools/agent-tool.test.ts` 中新增测试：
   - **测试 A: `abort 信号传播到子代理`**
     - 创建父 Agent + AgentTool
     - 使用自定义 `createMockStreamFn` 延迟响应（如 500ms）
     - 在 execute 开始后触发 `controller.abort()`
     - 验证 `execute` 抛出 `AbortError` 或返回包含 abort 信息的结果
     - 验证子代理的 `activeRun` 被中止（通过 `child.signal.aborted`）
   - **测试 B: `abort 监听器被正确清理`**
     - execute 正常完成后（无 abort）
     - 验证父 `AbortSignal` 上不再挂起子代理的监听器
     - 可通过检查 `signal` 的 listenerCount 或手动触发 abort 验证无副作用

**关键设计点：**

当前实现中，abort 传播通过以下机制：
```typescript
let onAbort: (() => void) | undefined;
if (context.abortSignal) {
  onAbort = () => child.abort();
  context.abortSignal.addEventListener("abort", onAbort, { once: true });
}
// ... try/finally 中 removeEventListener
```

测试需要验证这个机制的两个方面：传播有效性和资源清理。

**验收标准：**
- 父 abort 后子代理执行被中断
- 正常完成后 abort 监听器不泄漏

**验证步骤：**
```bash
bun test src/agent/tools/agent-tool.test.ts
```

---

### Slice 2: 嵌套子代理端到端测试补充

**目标：** 验证子代理可以正确创建孙代理，深度限制在链式场景下生效。

**当前状态：** 已有 `depth >= 3` 时抛出错误的测试，但只测试了单层 `execute`。没有验证子代理内部执行时会创建 `depth+1` 的 AgentTool。

**任务详情：**

1. 在 `src/agent/tools/agent-tool.test.ts` 中新增测试：
   - **测试 A: `子代理内部可调用 AgentTool 创建孙代理`**
     - Mock streamFn 返回包含 `toolCall`（AgentTool）的 assistant 消息
     - 子代理执行时会触发内部 AgentTool 的执行
     - 验证孙代理被创建并返回结果
     - 使用 `onUpdate` 或事件监听追踪执行过程
   - **测试 B: `嵌套深度限制在链式场景下生效`**
     - Mock streamFn 在 depth=2 时返回调用 AgentTool 的消息
     - depth=3 时返回调用 AgentTool 的消息
     - 验证 depth=3 的 AgentTool.execute 抛出深度超限错误

**Mock 策略：**

需要两个不同的 mock streamFn：
- `createMockStreamFnWithToolCall(toolCallContent)`：返回包含 toolCall 的 assistant 消息
- 子代理的 tool-execution 需要实际执行工具并产生 toolResult

这要求理解 `runAgentLoop` 如何处理 toolCall → execute → toolResult 的完整流程。可能需要：
1. 第一次 assistant 消息包含 toolCall
2. Loop 执行 toolCall（调用 AgentTool.execute）
3. Tool 结果产生后，loop 继续发送 toolResult 消息
4. 第二次 assistant 消息作为最终结果

**验收标准：**
- 子代理可触发孙代理创建并执行
- depth=3 时链式调用被阻断

**验证步骤：**
```bash
bun test src/agent/tools/agent-tool.test.ts
```

---

### Slice 3: 错误恢复测试补充

**目标：** 验证子代理执行失败时，AgentTool.execute 的异常处理行为。

**当前状态：** `agent-tool.ts` 的 `execute` 没有 try/catch 包裹 `child.prompt()` 和 `child.waitForIdle()`（只在 finally 中清理监听器）。

**任务详情：**

1. 先确认当前行为：
   - 子代理内部错误（如 streamFn 抛出异常）时，异常会直接上抛到 `AgentTool.execute` 的调用方
   - `tool-execution.ts` 中是否有默认的 try/catch？

2. 在 `src/agent/tools/agent-tool.test.ts` 中新增测试：
   - **测试 A: `子代理 streamFn 抛出异常时的行为`**
     - 使用抛出异常的 mock streamFn
     - 验证 `AgentTool.execute` 的行为：
       - 如果当前行为是抛出异常 → 记录为预期行为，测试验证异常正确上抛
       - 如果当前行为是静默失败 → 需要决策是否改为显式抛出
   - **测试 B: `子代理执行后无 assistant 消息时的回退行为`**
     - 已有该场景的处理：`return { result: "No response from subagent" }`
     - 补充测试验证此回退

**需要调研：**

读取 `src/agent/tool-execution.ts` 确认工具执行的错误处理机制：
- 工具 execute 抛出的异常是否被捕获并包装为 toolResult？
- 还是直接上抛导致整个 turn 失败？

**验收标准：**
- 子代理异常行为被测试覆盖
- 无 assistant 消息时的回退被测试覆盖

**验证步骤：**
```bash
bun test src/agent/tools/agent-tool.test.ts
```

---

### Slice 4: Spec 文档修正

**目标：** 更新 spec 文档，消除与实际实现的偏差，补充缺失的设计说明。

**当前偏差清单（来自 review）：**

| # | 偏差项 | Spec 描述 | 实际实现 |
|---|--------|-----------|----------|
| 1 | depth 追踪 | `ToolUseContext.depth` 字段 | 闭包 `createAgentTool(parent, depth)` |
| 2 | createSubagent 签名 | `createSubagent(parent, context)` | `createSubagent(parent)` |
| 3 | onPayload 传播 | 复制到子代理 | **不复制**（UI 隔离） |
| 4 | AgentTool 递归注册 | 未说明 | `execute` 中注册新 AgentTool |
| 5 | 工具列表过滤 | 未说明 | `tools.filter(t => t.name !== "Agent")` |
| 6 | 错误处理策略 | 未明确 | execute 不 catch，异常上抛 |
| 7 | abort 传播机制 | "共享 signal 或新建联动" | 监听父 signal + `child.abort()` |

**任务详情：**

1. 更新 `docs/ys-powers/specs/2026-06-01-subagent-design.md`：
   - **5.2 执行流程**：补充步骤 1.5 "注册递归 AgentTool"，说明 `child.registerTool(createAgentTool(child, depth + 1))`
   - **5.3 状态隔离**：修正 `onPayload` 为 **不传播**（UI 隔离），删除 `steeringQueue` 行（Agent 构造函数内部新建）
   - **5.4 嵌套深度限制**：修正为闭包追踪机制
   - **5.6 边界条件**：明确 "子代理执行失败" 的行为（异常上抛到 tool-execution 层）
   - **新增 5.7 工具列表过滤**：说明过滤 Agent tool 避免闭包污染的必要性
   - **6.1 测试策略**：更新测试清单，标记已完成/待补充

2. 更新 `docs/ys-powers/plans/2026-06-01-subagent.md`（可选）：
   - 标记已完成切片
   - 修正 Slice 1/3 中的过时描述

**验收标准：**
- Spec 文档与实际实现一致
- 所有已知偏差被修正

**验证步骤：**
```bash
# 人工 review：对比 spec 与源码
```

---

## Checkpoints（检查点）

| Checkpoint | 条件 | 验证命令 |
|---|---|---|
| **CP1** | Slice 1 完成 | `bun test src/agent/tools/agent-tool.test.ts`（abort 测试通过） |
| **CP2** | Slice 2 完成 | `bun test src/agent/tools/agent-tool.test.ts`（嵌套 E2E 测试通过） |
| **CP3** | Slice 3 完成 | `bun test src/agent/tools/agent-tool.test.ts`（错误恢复测试通过） |
| **CP4** | 全部完成 | `bun test` + `bun run typecheck` + spec 文档 review |

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 嵌套 E2E 测试需要复杂的 mock streamFn | 中 | 从 `runAgentLoop` 流程倒推需要的 assistant 消息序列 |
| tool-execution.ts 的异常处理机制未明确 | 中 | Slice 3 开始前先调研 tool-execution 的错误处理 |
| 测试运行时间增加（多次 mock agent loop）| 低 | 保持测试聚焦，避免过度嵌套 |
