# Subagent 功能设计文档

## 1. Objective（目标）

为 `ys-code` 实现子代理（subagent）功能，让 LLM 在对话中能够显式派生独立的子代理处理特定任务。

**核心价值：**
- **任务分解**：LLM 可将复杂任务拆分为独立的子任务，派生子代理并行/串行处理
- **关注点隔离**：子代理在独立的执行上下文中运行，避免状态污染
- **复用现有能力**：子代理复用父代理的工具池和系统提示，无需重新配置

**MVP 范围：**
- 只支持同步执行（阻塞当前 turn，结果直接返回）
- 只支持一个通用子代理类型（无 agent 定义目录）
- 完全继承父代理的工具列表和系统提示
- 不支持 worktree 隔离、异步执行、teammate/swarm 模式

## 2. Commands（命令）

无新增 CLI 命令。子代理通过 LLM 调用 `AgentTool` 工具触发。

## 3. Project Structure（项目结构）

```
src/agent/
  subagent/
    create-subagent.ts       # 子代理创建工厂
    create-subagent.test.ts  # 子代理创建测试
  tools/
    agent-tool.ts            # AgentTool 定义（新增）
    agent-tool.test.ts       # AgentTool 测试
```

## 4. Code Style（代码风格）

- 遵循现有 `src/agent/tools/` 目录下工具定义模式（`defineAgentTool` + TypeBox schema）
- 子代理创建函数返回 `Agent` 实例，与现有 `Agent` 类保持一致
- 状态隔离通过构造函数选项实现，不修改 `Agent` 类内部逻辑

## 5. Design（详细设计）

### 5.1 AgentTool Schema

```typescript
const inputSchema = Type.Object({
  prompt: Type.String({ description: "The task for the subagent to complete" }),
  description: Type.Optional(Type.String({ description: "A description of the task" })),
});

const outputSchema = Type.Object({
  result: Type.String({ description: "The subagent's response" }),
});
```

**字段说明：**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | `string` | 是 | 子代理的任务指令 |
| `description` | `string` | 否 | 任务描述，用于日志和调试 |

**输出：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `result` | `string` | 子代理执行完成后的最终响应文本 |

### 5.2 执行流程

```
AgentTool.execute(toolCallId, params, context)
  ├── 1. 深度检查
  │     └── depth >= MAX_SUBAGENT_DEPTH ? 抛出错误 : 继续
  ├── 2. 创建子代理 Agent 实例
  │     └── createSubagent(parentAgent)
  │         ├── 复制父代理的系统提示构建函数
  │         ├── 复制父代理的系统提示构建函数
  │         ├── 复制父代理的工具列表（过滤掉旧 AgentTool）
  │         ├── 复制父代理的 streamFn / convertToLlm
  │         └── 新建独立的 MutableAgentState
  ├── 3. 为子代理注册递归 AgentTool
  │     └── child.registerTool(createAgentTool(child, depth + 1))
  ├── 4. 注册 abort 监听器（若 context.abortSignal 存在）
  │     └── signal.addEventListener("abort", () => child.abort())
  ├── 5. 构建子代理的初始消息
  │     └── [system prompt] + [user message: params.prompt]
  ├── 6. 运行子代理的 agent loop
  │     └── child.prompt(params.prompt) + child.waitForIdle()
  │         ├── stream assistant response
  │         ├── execute tools（可再次触发 AgentTool，形成嵌套）
  │         └── ... (标准 loop)
  ├── 7. 清理 abort 监听器
  │     └── signal.removeEventListener("abort", onAbort)
  ├── 8. 收集子代理的最终响应
  │     └── 从子代理的 messages 中提取最后一条 assistant 消息
  └── 9. 返回结果
        └── { result: subagentFinalResponse }
```

### 5.3 状态隔离策略

| 状态项 | 父代理 | 子代理 | 策略 |
|--------|--------|--------|------|
| `_state.messages` | 独立 | **新建空列表** | 隔离 |
| `_state.tools` | 共享引用 | **共享引用** | 共享（工具定义不可变） |
| `_state.model` | 独立 | **复制** | 隔离 |
| `systemPrompt` | 共享函数 | **共享函数** | 共享 |
| `streamFn` | 共享引用 | **共享引用** | 共享 |
| `convertToLlm` | 共享引用 | **共享引用** | 共享 |
| `fileStateCache` | 独立 | **新建** | 隔离 |
| `listeners` | 独立 | **新建空 Set** | 隔离 |
| `sessionId` | 父代理 ID | **新建** | 隔离 |
| `onPayload` | 父代理回调 | **不复制** | 隔离（防止子代理流污染父代理 UI） |

**关键点：**
- 工具列表共享引用：工具定义（`AgentTool` 对象）是不可变的，共享安全
- 子代理的 `messages` 独立：不会污染父代理的对话历史
- 子代理无事件监听者：子代理的事件不会传播到父代理的 UI
- `onPayload` 不传播：子代理的流数据不会混入父代理的 UI 渲染

### 5.4 嵌套深度限制

防止无限递归（子代理再派生子代理）：

```typescript
const MAX_SUBAGENT_DEPTH = 3;
```

- 深度通过 `createAgentTool(parentAgent, depth)` 的闭包参数传递
- 深度从 0 开始（根代理）
- 每次创建子代理时，注册 `createAgentTool(child, depth + 1)`
- 超过 `MAX_SUBAGENT_DEPTH` 时抛出错误，拒绝执行

**为什么不使用 `ToolUseContext.depth`？**

`ToolUseContext` 是通用工具执行上下文，不应包含 Agent 特有的嵌套深度信息。闭包模式与现有 `createTodoWriteTool(store)` 等工厂函数一致，更符合项目编码风格。

### 5.5 系统提示处理

子代理的系统提示与父代理**完全一致**（字节精确），不做任何修改或增强。

理由：
- YS 当前没有 CC 的 `getSystemPrompt()` 动态构建机制
- 子代理需要与父代理相同的工具指导和行为规范
- 避免系统提示差异导致的行为不一致

### 5.6 边界条件

| 场景 | 行为 |
|------|------|
| 子代理调用工具失败 | 子代理内部处理（与父代理一致），最终结果可能包含错误信息 |
| 子代理执行超时 | 通过 `AbortController` 中止。但当前 `EventStream` 不支持 abort 中断，超时后子代理可能继续运行至完成 |
| 子代理无工具调用 | 直接返回 assistant 的文本响应 |
| 子代理深度超限 | 抛出错误，拒绝执行 |
| 父代理被中止 | 监听父 `AbortSignal` 并调用 `child.abort()`。但当前 `EventStream` 不支持 abort 中断，已运行的子代理不会被强制终止 |
| 子代理 streamFn 抛出异常 | `AgentTool.execute` 不抛出异常；子代理内部 `handleRunFailure` 捕获并添加错误 assistant 消息；最终返回 `"No text response from subagent"` |

### 5.7 工具列表过滤

子代理创建时，工具列表会过滤掉名称等于 `"Agent"` 的旧工具：

```typescript
tools: parentState.tools.filter((t) => t.name !== AGENT_TOOL_NAME)
```

**必要性：**
父代理的 `AgentTool` 实例持有指向父代理的闭包引用（`parentAgent`）。如果直接复制到子代理，子代理执行该工具时会操作父代理的状态（错误的 `messages`、错误的 `depth`）。过滤后，由 `AgentTool.execute` 在运行时重新注册新的 `createAgentTool(child, depth + 1)`，确保闭包指向正确的代理实例。

## 6. Testing Strategy（测试策略）

### 6.1 单元测试

| 测试文件 | 测试内容 | 状态 |
|----------|----------|------|
| `agent-tool.test.ts` | AgentTool schema、execute、结果收集、深度限制、监听器清理 | 已完成 |
| `create-subagent.test.ts` | 子代理创建、状态隔离验证 | 已完成 |

### 6.2 测试用例

**AgentTool 测试（已完成）：**
1. ✅ `execute` 成功调用子代理并返回结果
2. ✅ `execute` 子代理深度超限抛出错误（depth >= 3）
3. ✅ `execute` 正常边界（depth = 0, 2）
4. ✅ `execute` 完成后 abort 监听器被清理
5. ✅ `execute` 无 abortSignal 时正常执行
6. ✅ `execute` 子代理 streamFn 异常时返回回退结果
7. ✅ `formatResult` 返回文本格式
8. ✅ 子代理内部 AgentTool 可创建并执行孙代理（嵌套 E2E）

**状态隔离测试（已完成）：**
1. ✅ 子代理执行后父代理的 `messages` 不受影响
2. ✅ 子代理的 `fileStateCache` 独立
3. ✅ 子代理的 `sessionId` 与父代理不同

**已知缺口（需基础设施支持）：**
- 运行中子代理被 abort 中断：`EventStream` 当前不支持 abort 信号中断，已运行的子代理无法被强制终止

### 6.3 集成测试

在真实 agent loop 中验证：
1. LLM 调用 AgentTool 后，子代理正确执行并返回
2. 子代理的工具调用不影响父代理状态
3. 父代理继续执行时状态一致

**当前状态：** 第 1、2 项已通过嵌套 E2E 测试间接覆盖。第 3 项需要完整 agent loop 测试环境。

## 7. Boundaries（边界）

### 7.1 明确支持

- [x] 同步子代理执行（阻塞当前 turn）
- [x] 通用子代理类型（无 agent 定义目录）
- [x] 完全继承父代理工具列表
- [x] 状态隔离（messages、fileStateCache、listeners）
- [x] 嵌套深度限制（max 3）
- [x] AbortController 信号传播

### 7.2 明确不支持（MVP 范围外）

- [ ] 异步执行（后台 fork）
- [ ] Agent 定义目录（内置子代理类型如 Explore、code-reviewer）
- [ ] Worktree 隔离
- [ ] Teammate / Swarm 模式
- [ ] 自定义子代理工具列表（子集/超集）
- [ ] 子代理权限模式覆盖
- [ ] Prompt cache 共享优化
- [ ] AsyncLocalStorage 并发追踪
- [ ] 子代理生命周期管理（register/kill/fail）

### 7.3 决策记录（ADR）

**ADR-1：为什么不支持异步执行？**

YS 当前没有 CC 的 `LocalAgentTask` 任务注册系统和 `task-notification` 交互机制。引入异步执行需要同时建设：
1. 后台任务队列
2. 任务状态追踪（运行中/完成/失败）
3. 异步通知机制（`task-notification`）

这三个都是独立的大功能，应在子代理基础能力稳定后再引入。

**ADR-2：为什么不引入 agent 定义目录？**

CC 的 `loadAgentsDir` 支持从文件系统加载自定义 agent 定义（包含系统提示、工具白名单、权限模式等）。YS 当前没有此需求：
1. MVP 阶段通用子代理已覆盖主要场景
2. 特定类型的子代理可通过 `prompt` 中的角色指令模拟
3. 引入目录系统增加维护成本，待需求明确后再建设

**ADR-3：为什么完全继承工具列表？**

CC 的普通路径会根据子代理的 `permissionMode` 重新 `assembleToolPool`。YS 当前：
1. 没有 `permissionMode` 概念
2. 没有 MCP 工具
3. 工具定义不可变，共享引用安全

完全继承是最简单且正确的策略，与 CC 的 fork 路径一致。
