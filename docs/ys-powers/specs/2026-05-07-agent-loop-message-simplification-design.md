# Agent Loop 消息机制简化设计

## Objective

将 `agent-loop.ts` 中 `steering` / `followUp` / `pendingMessages` 三种并存的队列机制简化为统一的单层循环模型，消除死代码、副作用和循环嵌套，使控制流与 cc（claude-code-haha）对齐。

**核心目标**:
1. 删除未使用的 `followUp` 机制（队列、API、配置、测试）
2. 删除 `AgentContext.pendingMessages`，工具 `newMessages` 改为直接返回
3. 删除 `AgentContext.modelOverride`（无实际需求）
4. 删除工具返回中的 `contextModifier`（零消费）
5. 将两层嵌套循环改为单层 `while(true)`，与 cc 结构对齐
6. 保留 `steering`（用户输入插队）功能，API 不变

**非目标**:
- 不引入新的抽象概念（如 `turnQueue`、`Inbox`）
- 不改变工具执行语义（sequential/parallel 保留）
- 不改变事件发射顺序和时机
- 不改动 TUI 层（`app.tsx` 的 `session.steer()` 调用不变）

---

## Commands

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/agent/types.ts` | 修改 | 删除 `AgentContext.pendingMessages`、`AgentContext.modelOverride`、`AgentLoopConfig.getFollowUpMessages` |
| `src/agent/agent.ts` | 修改 | 删除 `followUpQueue`、`followUpMode`、`followUp()`、`clearFollowUpQueue()`、`hasQueuedMessages()` 中的 followUp 检查；`continue()` 简化；`reset()` 简化 |
| `src/agent/session.ts` | 修改 | 删除 `followUp()` 方法 |
| `src/agent/tool-execution.ts` | 修改 | `executeToolCalls` 返回 `{ toolResults, newMessages }`；删除写 `currentContext` 的副作用；删除 `contextModifier` |
| `src/agent/agent-loop.ts` | 重写 | 单层循环替代两层嵌套；删除 `modelOverride` 处理逻辑 |
| `src/agent/agent-loop.test.ts` | 修改 | 删除 followUp/modelOverride 测试；改造 newMessages 测试 |
| `src/agent/tool-execution.test.ts` | 修改 | 删除 pendingMessages/modelOverride 测试；新增 newMessages 返回值测试 |

### 验证命令

```bash
# 类型检查
bun run typecheck

# 单元测试
bun test ./src/agent/

# 全量测试
bun test
```

---

## Project Structure

### 改造前模块关系

```
Agent (agent.ts)
├── steeringQueue: PendingMessageQueue
├── steer(msg) ──► steeringQueue.enqueue()
└── createLoopConfig()
    └── getSteeringMessages: () => steeringQueue.drain()

AgentLoop (agent-loop.ts)
├── runTurnOnce(context, injectedMessages)
│   └── executeToolCalls() ──► returns { toolResults, newMessages }
└── runLoop()
    └── while(true)
        ├── injected = [...steering, ...toolNewMessages]
        ├── if (hasToolCalls) executeToolCalls() ──► toolNewMessages = newMessages
        └── break if (!hasToolCalls && !toolNewMessages && !steering)

AgentContext (types.ts)
├── messages
└── tools
```

### 改造后模块关系

```
Agent (agent.ts)
├── steeringQueue: PendingMessageQueue
├── steer(msg) ──► steeringQueue.enqueue()
└── createLoopConfig()
    └── getSteeringMessages: () => steeringQueue.drain()

AgentLoop (agent-loop.ts)
├── runTurnOnce(context, injectedMessages)
│   └── executeToolCalls() ──► returns { toolResults, newMessages }
└── runLoop()
    └── while(true)
        ├── injected = [...steering, ...toolNewMessages]
        ├── if (hasToolCalls) executeToolCalls() ──► toolNewMessages = newMessages
        └── break if (!hasToolCalls && !toolNewMessages && !steering)

AgentContext (types.ts)
├── messages
└── tools
```

---

## Code Style

### 单层循环原则

改造后的循环必须满足：

```typescript
while (true) {
  // 1. 收集输入
  const steering = await config.getSteeringMessages?.() || [];
  const injected = [...steering, ...pendingToolNewMessages];
  pendingToolNewMessages = [];
  
  // 2. 注入消息
  if (injected.length > 0) { /* ... */ }
  
  // 3. 执行 LLM turn
  const assistantMessage = await streamAssistantResponse(...);
  
  // 4. 错误检查
  if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
    await emit({ type: "agent_end" });
    return;
  }
  
  // 5. 工具执行
  const toolCalls = assistantMessage.content.filter(c => c.type === "toolCall");
  if (toolCalls.length > 0) {
    const { toolResults, newMessages } = await executeToolCalls(...);
    for (const result of toolResults) {
      currentContext.messages.push(result);
    }
    pendingToolNewMessages = newMessages || [];
  }
  
  await emit({ type: "turn_end", message: assistantMessage, toolResults });
  
  // 6. 结束判断
  if (toolCalls.length === 0 && pendingToolNewMessages.length === 0) {
    const nextSteering = await config.getSteeringMessages?.() || [];
    if (nextSteering.length === 0) break;
  }
}

await emit({ type: "agent_end" });
```

### 无副作用原则

- `executeToolCalls` **禁止**修改 `currentContext`
- `newMessages` 必须通过返回值传递
- 工具不再返回 `modelOverride` 和 `contextModifier`

---

## Testing Strategy

### 测试目标

验证"改造前后行为一致"：

1. **steering 注入时机**: 用户插队消息仍在正确的 turn 边界注入
2. **工具 newMessages**: 工具产生的隐藏消息仍被 LLM 看到
3. **事件顺序**: `turn_start`/`message_start`/`message_end`/`turn_end`/`agent_end` 顺序不变
4. **边界条件**: 
   - 无 steering + 无 tool calls → 立即结束
   - tool calls 产生 newMessages → 继续一轮
   - 工具执行期间用户 steering → 下轮注入

### 测试方法

- **现有测试改造**: 更新 `agent-loop.test.ts` 和 `tool-execution.test.ts` 中的断言
- **新增测试**: 
  - 验证 `executeToolCalls` 返回 `newMessages` 而非写 context
  - 验证单层循环中 steering 在 tool calls 之间仍可注入

### 回归验证

```bash
# 1. 类型检查通过
bun run typecheck

# 2. agent 层测试通过
bun test ./src/agent/

# 3. 全量测试通过
bun test
```

---

## Boundaries

### 必须做的

1. 删除所有 `followUp` 相关代码（队列、API、配置、测试）
2. 删除 `AgentContext.pendingMessages`
3. `executeToolCalls` 改为返回 `newMessages`
4. `agent-loop.ts` 改为单层循环

### 需要确认才能做的

- 如果后续需要"打断"（interrupt）功能，需要在 `Agent` 层新增 `abort(reason)` 支持，超出本次范围

### 绝对不能做的

1. **不改 TUI 层**: `app.tsx` 的 `session.steer()` 调用保持不变
2. **不改事件协议**: `AgentEvent` 类型不变（`turn_end`、`agent_end` 等保留）
3. **不改工具契约**: 工具的 `execute()` 返回类型仍包含 `newMessages`，只是消费方式改变
4. **不引入新依赖**: 不使用全局队列、状态机等新抽象
5. **不改 steering 语义**: `steeringMode`（`one-at-a-time`/`all`）保留
6. **不保留 modelOverride**: 彻底删除，不在任何位置保留兼容代码

---

## 风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 循环逻辑错误导致无限循环 | 测试覆盖所有退出路径（error/aborted/正常结束） |
| 工具 newMessages 丢失 | 测试验证 newMessages 返回后正确注入下轮 |
| steering 时机改变 | 测试验证 tool calls 之间仍可注入 steering |
| 事件顺序改变 | 对比改造前后的测试事件日志 |

回滚策略：
- 本次改动为纯重构，行为不变
- 如发现问题，可直接 `git revert` 回滚
