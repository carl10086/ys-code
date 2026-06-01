# CC AgentTool 源码分析

> 来源：`refer/claude-code-haha/src/tools/AgentTool/AgentTool.tsx`
> 行数：1397 行

## 1. 参数 Schema（inputSchema）

```typescript
const baseInputSchema = z.object({
  prompt: z.string().describe('The task for the agent to complete'),
  subagent_type: z.string().optional().describe('The type of subagent to use'),
  description: z.string().optional().describe('A description of the task'),
  model: z.string().optional().describe('The model to use for the subagent'),
  run_in_background: z.boolean().optional().describe('Run in background'),
  name: z.string().optional(),           // teammate 名称
  team_name: z.string().optional(),      // swarm 团队名
  mode: permissionModeSchema.optional(), // 权限模式
  isolation: z.enum(['worktree', 'remote']).optional(),
  cwd: z.string().optional(),            // 工作目录覆盖
});
```

**字段说明：**

| 字段 | 必需 | 说明 |
|------|------|------|
| `prompt` | 是 | 子代理的任务指令 |
| `subagent_type` | 否 | 子代理类型（如 `Explore`、`code-reviewer`）。省略时若 fork gate 开启则走 fork 路径 |
| `description` | 否 | 任务描述，用于 UI 展示和日志 |
| `model` | 否 | 覆盖子代理使用的模型 |
| `run_in_background` | 否 | 是否后台异步执行 |
| `isolation` | 否 | 隔离模式：`worktree`（git worktree）或 `remote` |
| `cwd` | 否 | 覆盖工作目录 |

## 2. 执行路径（call 方法）

```
call() 入口
  ├── 1. 解析参数
  ├── 2. 队友路由（teammate spawn）→ spawnTeammate()
  ├── 3. 确定 effectiveType
  │     ├── subagent_type 明确设置 → 使用该类型
  │     ├── subagent_type 省略 + fork gate 开启 → fork 路径（undefined）
  │     └── subagent_type 省略 + fork gate 关闭 → 默认 general-purpose
  ├── 4. 选择 AgentDefinition
  │     ├── fork 路径 → FORK_AGENT（synthetic 定义）
  │     └── 普通路径 → 从 activeAgents 查找匹配类型
  ├── 5. 检查 MCP server 依赖
  ├── 6. 确定是否异步执行
  │     └── shouldRunAsync = run_in_background || selectedAgent.background || coordinator || fork || assistantMode
  ├── 7. 组装 worker 工具池
  │     └── assembleToolPool(workerPermissionContext, mcpTools)
  ├── 8. 可选：创建 worktree 隔离
  └── 9. 调用 runAgent()
        ├── 同步路径 → 阻塞执行，结果直接返回
        └── 异步路径 → registerAsyncAgent()，通过 task-notification 交互
```

## 3. Fork 路径特殊处理

```typescript
if (isForkPath) {
  // 递归 fork 防护
  if (isInForkChild(toolUseContext.messages)) {
    throw new Error('Fork is not available inside a forked worker');
  }
  selectedAgent = FORK_AGENT;
}
```

**FORK_AGENT 定义：**

```typescript
const FORK_AGENT = {
  agentType: 'fork',
  tools: ['*'],           // 继承父代理的完整工具池
  maxTurns: 200,
  model: 'inherit',       // 继承父代理模型
  permissionMode: 'bubble', // 权限提示上浮到父终端
  source: 'built-in',
  getSystemPrompt: () => '', // 实际使用 override.systemPrompt 传入父代理渲染后的系统提示
};
```

**Fork 执行参数：**

```typescript
{
  override: { systemPrompt: forkParentSystemPrompt }, // 父代理的系统提示（字节精确）
  availableTools: toolUseContext.options.tools,        // 父代理的完整工具池
  forkContextMessages: toolUseContext.messages,        // 父代理的完整对话历史
  useExactTools: true,
}
```

## 4. 同步 vs 异步执行

### 同步执行

```typescript
const agentIterator = runAgent({ isAsync: false, ... });
for await (const msg of agentIterator) {
  // 流式收集消息
}
// 返回 completed 状态 + prompt
return { data: { status: 'completed', prompt, ... } };
```

### 异步执行

```typescript
const backgroundedTaskId = registerAsyncAgent({
  agentId: earlyAgentId,
  description,
  prompt,
  toolUseId: toolUseContext.toolUseId,
  agentType: selectedAgent.agentType,
  model: resolvedAgentModel,
}, rootSetAppState);

// 启动后台执行
runAgent({ isAsync: true, ... })
  .then(() => completeAsyncAgent(backgroundedTaskId, rootSetAppState))
  .catch(err => failAsyncAgent(backgroundedTaskId, errMsg, rootSetAppState));

// 立即返回 async_launched 状态
return { data: { status: 'async_launched', agentId, description, prompt, outputFile, ... } };
```

## 5. 生命周期管理

| 函数 | 作用 | 位置 |
|------|------|------|
| `registerAsyncAgent()` | 注册异步子代理任务到 AppState.tasks | AgentTool.tsx:688 |
| `registerAgentForeground()` | 注册前台子代理 | AgentTool.tsx:819 |
| `killAsyncAgent()` | 中止异步子代理 | AgentTool.tsx:996 |
| `failAsyncAgent()` | 标记异步子代理失败 | AgentTool.tsx:1019 |
| `unregisterAgentForeground()` | 注销前台子代理 | AgentTool.tsx:1163 |

## 6. 权限与工具池

```typescript
const workerPermissionContext = {
  ...appState.toolPermissionContext,
  mode: selectedAgent.permissionMode ?? 'acceptEdits'
};
const workerTools = assembleToolPool(workerPermissionContext, appState.mcp.tools);
```

**关键点：**
- 子代理使用自己的 `permissionMode`（非继承父代理）
- 工具池根据子代理权限重新组装
- fork 路径使用 `useExactTools: true` 保持工具定义字节精确（cache hit）
