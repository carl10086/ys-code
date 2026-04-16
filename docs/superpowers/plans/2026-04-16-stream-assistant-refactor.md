# stream-assistant.ts 完整重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `src/agent/stream-assistant.ts` 进行完整重构，修复类型安全、补全中文注释

**Architecture:** 仅文本注释和类型改动，不改变任何代码逻辑

**Tech Stack:** TypeScript

---

## 文件概览

- 修改: `src/agent/stream-assistant.ts`
- 测试: `src/agent/__tests__/stream-assistant.test.ts`

---

## Task 1: 添加 streamAssistantResponse 函数中文注释

**Files:**
- Modify: `src/agent/stream-assistant.ts:39-45`

- [ ] **Step 1: 为 streamAssistantResponse 函数添加中文注释**

将函数注释修改为：

```typescript
/**
 * 流式获取 assistant 响应
 * @param context Agent 上下文
 * @param config AgentLoop 配置
 * @param signal 可选的 abort 信号
 * @param emit 事件发射器
 * @param streamFn 可选的流函数
 * @returns AssistantMessage 最终消息
 */
export async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
```

---

## Task 2: 修复类型安全问题

**Files:**
- Modify: `src/agent/stream-assistant.ts:53-57`

- [ ] **Step 1: 查找正确的 LlmTools 类型**

检查 `../core/ai/index.js` 导出，确定 tools 字段的正确类型。

- [ ] **Step 2: 替换 as any 类型断言**

将 `context.tools as any` 修改为类型安全的转换：

```typescript
const llmContext: Context = {
  systemPrompt: context.systemPrompt,
  messages: llmMessages,
  tools: (context.tools ?? []) as LlmTools,
};
```

---

## Task 3: 为 switch case 分支添加中文注释

**Files:**
- Modify: `src/agent/stream-assistant.ts:73-109`

- [ ] **Step 1: 为 start 分支添加注释**

将 `case "start":` 修改为：

```typescript
case "start": {
  // 消息开始，创建 partial message
  partialMessage = event.partial;
  context.messages.push(partialMessage);
  addedPartial = true;
  await emit({ type: "message_start", message: { ...partialMessage } });
  break;
}
```

- [ ] **Step 2: 为 text/thinking/toolcall 分支添加注释**

将 `case "text_start":` 等修改为：

```typescript
case "text_start":   // 文本块开始
case "text_delta":   // 文本增量
case "text_end":     // 文本块结束
case "thinking_start":   // 思考开始
case "thinking_delta":   // 思考增量
case "thinking_end":     // 思考结束
case "toolcall_start":   // 工具调用开始
case "toolcall_delta":   // 工具调用增量
case "toolcall_end":     // 工具调用结束
```

- [ ] **Step 3: 为 done/error 分支添加注释**

将 `case "done":` 和 `case "error":` 修改为：

```typescript
case "done":   // 流式响应完成
case "error": {   // 流式响应错误
```

---

## Task 4: 验证与提交

**Files:**
- Modify: `src/agent/stream-assistant.ts`

- [ ] **Step 1: 运行 TypeScript 类型检查**

Run: `cd /Users/carlyu/soft/projects/ys-code && npx tsc --noEmit src/agent/stream-assistant.ts`
Expected: 无错误输出

- [ ] **Step 2: 运行测试**

Run: `cd /Users/carlyu/soft/projects/ys-code && bun test src/agent/__tests__/stream-assistant.test.ts`
Expected: 全部测试通过

- [ ] **Step 3: 提交变更**

```bash
git add src/agent/stream-assistant.ts
git commit -m "refactor(stream-assistant.ts): 修复类型安全并补全中文注释

- 修复 context.tools as any 类型断言问题
- 为 streamAssistantResponse 添加中文注释
- 为 switch case 分支添加中文注释
- 统一注释风格

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] `context.tools as any` 类型断言已消除
- [ ] `streamAssistantResponse` 函数有完整中文注释
- [ ] switch case 分支都有中文注释
- [ ] TypeScript 编译无错误
- [ ] 测试全部通过
- [ ] git commit 成功
