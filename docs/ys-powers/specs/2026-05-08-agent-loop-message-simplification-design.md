# Agent Loop 消息机制简化设计

## Objective

将 `agent-loop.ts` 中的循环结构从两层嵌套 + `runTurnOnce` 辅助函数，彻底改造为与 cc（claude-code-haha）对齐的单层 `while(true)` 结构。所有循环逻辑直接内联在循环体中，通过显式状态变量（`state = next`）驱动迭代，消除"turn"抽象层。

**核心目标**:
1. **删除 `runTurnOnce` 函数** —— 所有逻辑直接写在 `while(true)` 体内，循环迭代即工作单元
2. **删除未使用的 `followUp` 机制**（队列、API、配置、测试）
3. **删除 `AgentContext.pendingMessages`** —— 工具 `newMessages` 改为通过返回值显式传递
4. **删除 `AgentContext.modelOverride`**（无实际需求）
5. **删除工具返回中的 `contextModifier`**（零消费）
6. **引入显式状态管理** —— 每轮迭代从 `state` 读取，构建 `next`，最后 `state = next`
7. **保留 `steering`（用户输入插队）功能**，TUI API 不变

**非目标**:
- 不引入新的抽象概念（如 `turnQueue`、`Inbox`、状态机）
- 不改变工具执行语义（sequential/parallel 保留）
- 不改变事件发射顺序和时机
- 不改动 TUI 层（`app.tsx` 的 `session.steer()` 调用不变）

---

## Commands

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/agent/types.ts` | 修改 | 删除 `AgentContext.pendingMessages`、`AgentContext.modelOverride`、`AgentToolResult.contextModifier`、`AgentToolResult.modelOverride`、`AgentLoopConfig.getFollowUpMessages` |
| `src/agent/agent.ts` | 修改 | 删除 `followUpQueue`、`followUpMode`、`followUp()`、`clearFollowUpQueue()`、`hasQueuedMessages()` 中的 followUp 检查；`continue()` 删除 followUp 分支；`reset()` 删除 `clearFollowUpQueue()`；`createLoopConfig()` 删除 `getFollowUpMessages` |
| `src/agent/session.ts` | 修改 | 删除 `followUp()` 方法（两个重载） |
| `src/agent/tool-execution.ts` | 修改 | `executeToolCalls` 返回 `{ toolResults, newMessages }`；删除写 `currentContext` 的副作用；删除 `contextModifier` 提取逻辑 |
| `src/agent/agent-loop.ts` | 重写 | 单层 `while(true)`，无 `runTurnOnce`，显式状态管理 |
| `src/agent/agent-loop.test.ts` | 重写 | 删除 followUp/modelOverride 测试；改造 newMessages 测试以验证返回值而非 context 副作用；删除 `runTurnOnce` 存在性断言 |
| `src/agent/tool-execution.test.ts` | 修改 | 删除 pendingMessages/modelOverride 副作用测试；新增 `newMessages` 返回值测试 |
| `src/agent/tools/skill.ts` | 修改 | 删除 `contextModifier` 和 `modelOverride` 从 `SkillOutputSchema` 和 execute 返回值 |
| `src/agent/tools/skill.test.ts` | 修改 | 删除 modelOverride 测试；删除 contextModifier 测试 |

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
├── followUpQueue: PendingMessageQueue        [删除]
├── steer(msg) ──► steeringQueue.enqueue()
├── followUp(msg) ──► followUpQueue.enqueue() [删除]
└── createLoopConfig()
    ├── getSteeringMessages: () => steeringQueue.drain()
    └── getFollowUpMessages: () => followUpQueue.drain() [删除]

AgentLoop (agent-loop.ts)
├── runTurnOnce(context, injectedMessages)    [删除]
│   ├── streamAssistantResponse()
│   └── executeToolCalls() ──► 副作用写 context.pendingMessages
└── runLoop()
    └── while(true)
        └── while(hasToolCalls || pendingMessages.length > 0) [嵌套删除]

AgentContext (types.ts)
├── messages
├── tools
├── pendingMessages?                          [删除]
└── modelOverride?                            [删除]
```

### 改造后模块关系

```
Agent (agent.ts)
├── steeringQueue: PendingMessageQueue
├── steer(msg) ──► steeringQueue.enqueue()
└── createLoopConfig()
    └── getSteeringMessages: () => steeringQueue.drain()

AgentLoop (agent-loop.ts)
└── runLoop() / runAgentLoop() / runAgentLoopContinue()
    └── while(true)
        ├── state 解构（messages, tools, pendingToolNewMessages, pendingSteering, turnCount）
        ├── 注入 pendingSteering + pendingToolNewMessages
        ├── streamAssistantResponse()
        ├── 执行工具（如有）
        ├── 发射 turn_end
        ├── 错误检查
        ├── 末尾 drain steering 用于下一轮
        ├── 构建 next state
        └── state = next

AgentContext (types.ts)
├── messages
└── tools
```

---

## Code Style

### 单层循环原则

改造后的循环必须满足：**不存在任何将一轮完整迭代逻辑封装起来的辅助函数**。所有步骤直接写在 `while(true)` 体内：

```typescript
export async function runAgentLoop(...) {
  // 初始化 state
  // turnCount = 0 表示首次迭代，turn_start 已由 runAgentLoop 预先发射
  let state: LoopState = {
    messages: [...context.messages, ...prompts],
    tools: context.tools ?? [],
    pendingToolNewMessages: [],
    pendingSteering: [],
    turnCount: 0,
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  while (true) {
    // 1. 从 state 读取当前值
    let { messages, tools, pendingToolNewMessages, pendingSteering, turnCount } = state;

    // 2. 组合上一轮末尾 drain 的 steering + 工具返回的 newMessages
    const toInject = [...pendingSteering, ...pendingToolNewMessages];
    pendingToolNewMessages = [];
    pendingSteering = [];

    // 3. turn_start 事件（首次迭代已预先发射，跳过）
    if (turnCount > 0) {
      await emit({ type: "turn_start" });
    }

    // 4. 注入消息并发射事件
    if (toInject.length > 0) {
      for (const message of toInject) {
        await emit({ type: "message_start", message });
        await emit({ type: "message_end", message });
        messages.push(message);
      }
    }

    // 5. 请求 assistant 回复（核心工作）
    // 注意：streamAssistantResponse 会 mutate messages 数组，将 assistant message 追加到尾部
    const assistantMessage = await streamAssistantResponse(
      { messages, tools, sentSkillNames: context.sentSkillNames, invokedSkills: context.invokedSkills },
      config,
      signal,
      emit,
      streamFn,
    );

    // 6. 工具执行
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
    let toolResults: ToolResultMessage[] = [];
    if (toolCalls.length > 0) {
      const execution = await executeToolCalls(
        { messages, tools, sentSkillNames: context.sentSkillNames, invokedSkills: context.invokedSkills },
        assistantMessage,
        config,
        signal,
        emit,
      );
      toolResults = execution.toolResults;
      pendingToolNewMessages = execution.newMessages || [];
      for (const result of toolResults) {
        messages.push(result);
      }
    }

    // 7. 发射 turn_end（必须在 error/aborted 检查之前）
    await emit({ type: "turn_end", message: assistantMessage, toolResults });

    // 8. 错误/中止检查
    if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
      await emit({ type: "agent_end" });
      return;
    }

    // 9. 末尾 drain steering：本轮期间用户触发的 steering 在下一轮注入
    const nextSteering = (await config.getSteeringMessages?.()) || [];

    // 10. 结束判断：是否需要继续下一轮
    const shouldContinue = toolCalls.length > 0
      || pendingToolNewMessages.length > 0
      || nextSteering.length > 0;

    if (!shouldContinue) {
      await emit({ type: "agent_end" });
      return;
    }

    // 11. 构建下一轮 state
    state = {
      messages,
      tools,
      pendingToolNewMessages,
      pendingSteering: nextSteering,
      turnCount: turnCount + 1,
    };
  }
}
```

### 显式状态管理原则

- **局部 state 变量**：`state` 是 `while(true)` 体内的局部变量，不通过参数传递给子函数
- **显式推进**：每轮迭代结束时构建 `next state`，然后 `state = next`，避免在循环体中途修改 `state` 字段
- **无副作用（工具层）**：`executeToolCalls` 禁止修改任何上下文对象，所有产出通过返回值传递
- **无 "turn" 抽象**：循环迭代本身就是工作单元，不存在 `runOnce` / `runTurnOnce` 等封装函数
- **承认遗留 mutation**：`streamAssistantResponse` 是现有依赖，内部会直接 `push` / 替换 `messages` 数组元素。循环状态中的 `messages` 是可变数组，通过引用传递，由 `streamAssistantResponse` 追加 assistant message，由循环体追加 tool results

---

## Testing Strategy

### 测试目标

验证"改造前后行为一致"：

1. **steering 注入时机**: 用户插队消息仍在正确的 turn 边界注入
2. **工具 newMessages**: 工具产生的隐藏消息仍被 LLM 看到（通过返回值传递而非副作用）
3. **事件顺序**: `turn_start` → `message_start`/`message_end` → `turn_end` → `agent_end` 顺序不变
4. **边界条件**:
   - 无 steering + 无 tool calls → 立即结束
   - tool calls 产生 newMessages → 继续一轮
   - 工具执行期间用户 steering → 下轮注入
5. **error/aborted 时**: `turn_end` 必须先于 `agent_end` 发射

### 测试方法

- **现有测试改造**: 更新 `agent-loop.test.ts` 和 `tool-execution.test.ts`
  - `tool-execution.test.ts` 中：断言 `execution.newMessages` 而非 `context.pendingMessages`
  - `agent-loop.test.ts` 中：删除 `followUp` 测试、`modelOverride` 测试、`runTurnOnce` 存在性断言
- **新增测试**:
  - 验证 `executeToolCalls` 返回 `newMessages` 数组（不修改 context）
  - 验证单层循环中 steering 在 tool calls 之后仍可注入
  - 验证 `stopReason === "error"` 时 `turn_end` 先于 `agent_end` 发射

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

1. 删除 `agent-loop.ts` 中的 `runTurnOnce` 函数，所有逻辑内联到 `while(true)`
2. 删除所有 `followUp` 相关代码（队列、API、配置、测试）
3. 删除 `AgentContext.pendingMessages` 和 `AgentContext.modelOverride`
4. 删除 `AgentToolResult.contextModifier` 和 `AgentToolResult.modelOverride`
5. `executeToolCalls` 改为返回 `{ toolResults, newMessages }`，禁止修改 `currentContext`
6. `agent-loop.ts` 中使用局部 `state` 变量和 `state = next` 模式
7. `turn_end` 必须在 error/aborted 检查之前发射

### 需要确认才能做的

- 如果后续需要"打断"（interrupt）功能，需要在 `Agent` 层新增 `abort(reason)` 支持，超出本次范围

### 绝对不能做的

1. **不改 TUI 层**: `app.tsx` 的 `session.steer()` 调用保持不变
2. **不改事件协议**: `AgentEvent` 类型不变（`turn_end`、`agent_end` 等保留）
3. **不改工具契约**: 工具的 `execute()` 返回类型仍包含 `newMessages`，只是消费方式改变
4. **不引入新依赖**: 不使用全局队列、状态机、turnQueue 等新抽象
5. **不改 steering 语义**: `steeringMode`（`one-at-a-time`/`all`）保留
6. **不保留 modelOverride 兼容代码**: 彻底删除，不在任何位置保留 fallback
7. **不保留 runTurnOnce**: 彻底删除，不在任何位置保留辅助函数

---

## 风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 循环逻辑错误导致无限循环 | 测试覆盖所有退出路径（error/aborted/正常结束）；显式状态管理使循环条件一目了然 |
| 工具 newMessages 丢失 | 测试验证 `executeToolCalls` 返回 `newMessages` 后由循环体正确注入下轮 |
| steering 时机改变 | 测试验证 tool calls 之间和之后均可注入 steering |
| 事件顺序改变 | 对比改造前后的测试事件日志；特别验证 `turn_end` 在 `agent_end` 之前 |
| 删除 followUp 影响已有调用 | 全局搜索确认零非测试调用；`AgentSession.followUp` 同步删除 |

回滚策略：
- 本次改动为纯重构，行为不变
- 如发现问题，可直接 `git revert` 回滚
