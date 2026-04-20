# Tool NewMessages 自动注入设计

> **目标**：让工具返回的 `newMessages` 能自动触发下一轮循环，使 LLM 能在同一 turn 内看到这些消息。

## 背景

当前 `SkillTool` 返回 `newMessages`（包含 skill 内容的 meta 消息），但这些消息只是被加入了 `currentContext.messages`，并没有触发新的一轮循环。LLM 看不到这些消息。

参考 CC 的 `pendingMessages` 机制，但 ys-code 可以用更简单的设计：**利用 `context.pendingMessages` 作为通信通道**。

## 设计方案

### 核心机制

```
工具返回 newMessages
    ↓
executeToolCalls 将 newMessages 加入 context.pendingMessages
    ↓
runTurnOnce 返回
    ↓
runLoop 检查 context.pendingMessages，有内容则继续循环
```

### 数据流详解

```
runAgentLoop()
    ↓
runLoop(currentContext, ...)
    ↓
while (true) {
    runTurnOnce()
        ↓
        streamAssistantResponse() → LLM 响应
        ↓
        executeToolCalls()
            ↓
            SkillTool.execute() 返回 { newMessages: [metaMsg] }
            ↓
            // 关键改动：不加入 messages，加入 pendingMessages
            context.pendingMessages = context.pendingMessages || []
            context.pendingMessages.push(...newMessages)
        ↓
        return { assistantMessage, toolResults }
    }
    ↓
    // 检查 context.pendingMessages
    const pending = currentContext.pendingMessages || []
    if (pending.length > 0) {
        currentContext.pendingMessages = []  // 清空
        pendingMessages = pending          // 加入 pendingMessages
        continue                         // 触发新一轮循环
    }
    ↓
    // 无新消息，结束
    break
}
```

### 类型变更

**文件**: `src/agent/types.ts`

```typescript
interface AgentContext {
  messages: AgentMessage[];
  tools?: AgentTool<any, any>[];
  model?: Model<any>;
  sessionId?: string;
  pendingToolCalls?: Set<string>;
  pendingMessages?: AgentMessage[];  // 新增：工具返回的新消息，供循环使用
}
```

### 代码变更

#### 1. executeToolCalls 处理 newMessages

**文件**: `src/agent/tool-execution.ts`

**Sequential 模式** (line 220-232):

```typescript
const executed = await executePreparedToolCall(preparation, currentContext, config, signal, emit);
// 改为加入 context.pendingMessages，不加入 messages
if (executed.newMessages && executed.newMessages.length > 0) {
  currentContext.pendingMessages = currentContext.pendingMessages || [];
  currentContext.pendingMessages.push(...executed.newMessages);
  logger.debug("Tool newMessages queued for next turn", { count: executed.newMessages.length });
}
// 删除原来的 currentContext.messages.push(...newMessages)
```

**Parallel 模式** (line 279-290): 同样修改

#### 2. runLoop 检查 pendingMessages

**文件**: `src/agent/agent-loop.ts`

在 `runTurnOnce` 调用之后，`while (hasMoreToolCalls)` 循环结束后检查：

```typescript
// runLoop 中的逻辑调整
while (hasMoreToolCalls || pendingMessages.length > 0) {
  // ... 执行 runTurnOnce ...
}

// 关键：在 tool 循环结束后检查 context.pendingMessages
const contextPending = currentContext.pendingMessages || [];
if (contextPending.length > 0) {
  currentContext.pendingMessages = [];
  pendingMessages = contextPending;
  hasPreEmittedTurnStart = false;
  continue;
}
```

#### 3. 移除 followUpQueue（可选优化）

如果确定 `context.pendingMessages` 足够，可以考虑：

1. 移除 `PendingMessageQueue` 的 `followUpQueue`
2. 移除 `Agent.followUp()` 方法（如果只用于内部）
3. 保留 `Session.followUp()`，但改为加入 `context.pendingMessages`

**此优化可选，先完成核心功能再决定是否做。**

### 行为对比

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| SkillTool 返回 newMessages | 消息加入 messages，LLM 看不到 | 消息加入 pendingMessages，触发新一轮 |
| 用户调用 session.followUp() | 加入 followUpQueue | 可改为加入 context.pendingMessages |
| 循环结束条件 | 无新 tool calls + 无 pending | 无新 tool calls + 无 pending + 无 context.pending |

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agent/types.ts` | 修改 | AgentContext 添加 pendingMessages |
| `src/agent/tool-execution.ts` | 修改 | newMessages 加入 context.pendingMessages |
| `src/agent/agent-loop.ts` | 修改 | runLoop 检查并处理 context.pendingMessages |

## 成功标准

1. 调用 `/brainstorming` 后，LLM 能在同一 turn 收到 skill 内容（不再出现 "OK Skill" 后无响应）
2. `isMeta: true` 的消息在 UI 中不显示（MessageList 过滤）
3. `bun test` 全部通过

## 待验证

- [ ] `followUp` 方法是否还需要保留？
- [ ] `followUpQueue` 是否可以移除？
