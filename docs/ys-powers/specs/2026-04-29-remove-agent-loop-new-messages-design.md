# Spec: 删除 agent-loop 增量 newMessages 设计

## Objective

本设计目标是删除 `src/agent/agent-loop.ts` 中用于收集“本次 agent loop 新增消息”的增量 `newMessages` 设计，降低 agent loop 的参数传递复杂度和阅读成本。

当前代码里存在两类同名概念：

- `agent-loop.ts` 的 `newMessages`: 本次 `runAgentLoop()` / `runAgentLoopContinue()` 调用期间产生的增量消息集合。
- tool result 的 `newMessages`: 工具执行后注入到下一轮模型上下文的消息，例如 `SkillTool` 注入 `isMeta` skill prompt。

本次只删除第一类。第二类是有效机制，必须保留。

成功状态：

- `runAgentLoop()` 和 `runAgentLoopContinue()` 不再返回 `AgentMessage[]`。
- `AgentEvent` 的 `agent_end` 不再携带 `messages`。
- `runLoop()` 和 `runTurnOnce()` 不再接收或维护 agent-loop 级别的 `newMessages`。
- tool result 的 `newMessages` 到 `currentContext.pendingMessages` 再到下一轮上下文注入的链路保持不变。

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Test framework: Bun test
- 主要模块:
  - `src/agent/agent-loop.ts`
  - `src/agent/agent.ts`
  - `src/agent/types.ts`
  - `src/agent/tool-execution.ts`
  - `src/agent/tools/skill.ts`

## Commands

验证命令以仓库现有 Bun/TypeScript 流程为准：

```bash
bun test src/agent/agent-loop.test.ts
bun test src/agent/tool-execution.test.ts
bun test src/agent/tools/skill.test.ts
bun test src/agent/session.test.ts
bun test
```

如果仓库提供全量类型检查命令，应额外运行：

```bash
bun run typecheck
```

## Project Structure

本次设计影响范围应保持在 agent loop 和相关测试内：

```text
src/agent/agent-loop.ts
  删除 agent-loop 级别 newMessages 收集器、返回值和 agent_end payload 依赖。

src/agent/types.ts
  收窄 AgentEvent.agent_end 类型，移除 messages 字段。

src/agent/agent.ts
  更新 processEvents() 和异常路径中的 agent_end 事件构造。

src/agent/agent-loop.test.ts
  调整对 runAgentLoop()/runAgentLoopContinue() 返回值和 agent_end.messages 的断言。

src/agent/session.test.ts
  调整手动构造 agent_end 事件的测试输入。

src/agent/tool-execution.ts
src/agent/tools/skill.ts
src/agent/tool-execution.test.ts
src/agent/tools/skill.test.ts
  不删除 tool result newMessages；只用于回归验证该机制未受影响。
```

## Code Style

实现时应优先删除无效状态，而不是保留兼容空字段。

推荐方向：

```ts
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | ToolExecutionEvent;
```

`runAgentLoop()` 的职责应变为“驱动消息事件和状态推进”，不再承担“返回本轮增量”的职责：

```ts
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<void> {
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, config, signal, emit, streamFn);
}
```

注意：不要把 tool result 的 `newMessages` 一起删除。若后续需要改善命名，应另开一次重构，把它改名为 `nextTurnMessages` 或 `injectedMessages`。

## Testing Strategy

测试应覆盖两类行为：

1. agent-loop 级别增量返回被删除后，主流程仍正常推进。
2. tool result `newMessages` 注入下一轮上下文的能力仍正常工作。

需要调整的测试：

- `src/agent/agent-loop.test.ts`
  - 不再断言 `runAgentLoop()` 返回数组长度。
  - 改为断言 `message_start` / `message_end` / `turn_end` / `agent_end` 事件顺序。
  - 对 `runAgentLoopContinue()` 同样不再依赖返回值。

- `src/agent/session.test.ts`
  - 手动构造 `agent_end` 时不再传 `messages: []`。

需要保留的测试：

- `src/agent/tool-execution.test.ts`
  - “工具返回 newMessages 时加入 currentContext.pendingMessages”必须继续通过。
  - 并行执行时多个工具返回的 `newMessages` 都应进入 `pendingMessages`。

- `src/agent/tools/skill.test.ts`
  - `SkillTool` 成功执行时仍返回 `newMessages`，内容为 `isMeta=true` 的 user message。

## Boundaries

- Always:
  - 保留 tool result `newMessages` 机制。
  - 保留 `currentContext.pendingMessages` 注入下一轮 turn 的行为。
  - 保留 `message_start` / `message_end` 作为状态写入通道。
  - 修改测试以验证行为，而不是迁就旧接口。

- Ask first:
  - 是否同步重命名 tool result 的 `newMessages`。
  - 是否删除当前未使用的 `contextModifier`。
  - 是否改变 `Agent.processEvents()` 对 `message_end` 的持久化行为。

- Never:
  - 不删除 `SkillTool` 注入 skill prompt 的能力。
  - 不把 `agent_end` 当作消息持久化入口。
  - 不为了兼容测试保留空的 `messages: []` payload。
  - 不扩大到 compact、session persistence 或 TUI 渲染重构。

## Success Criteria

- `runAgentLoop()` 和 `runAgentLoopContinue()` 的返回类型改为 `Promise<void>`。
- `AgentEvent.agent_end` 类型变为 `{ type: "agent_end" }`。
- `src/agent/agent-loop.ts` 中不存在 agent-loop 级别的 `newMessages` 参数、局部变量或 `newMessages.push()`。
- `src/agent/tool-execution.ts` 中 tool result `newMessages` 仍会写入 `currentContext.pendingMessages`。
- `src/agent/tools/skill.ts` 中 `SkillTool` 仍通过 tool result `newMessages` 注入 `isMeta` skill 内容。
- 相关 agent 测试通过，尤其是 agent-loop、tool-execution、skill、session 测试。

## Open Questions

- 是否在本次实现中顺手把 tool result `newMessages` 改名为 `nextTurnMessages`？
  - 当前建议：不做，避免把“删除无用设计”和“重命名有效机制”混在同一改动里。

- 是否删除 `AgentToolResult.contextModifier`？
  - 当前建议：不做，需要单独阅读和评估，因为它是另一个疑似未完全落地的扩展点。
