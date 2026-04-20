# Skill Meta Message 同一 Turn 注入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 meta message（skill 内容）与用户输入在同一个 turn 发送给 LLM

**Architecture:** 扩展 `AgentSession.prompt()` 支持 `AgentMessage[]`，在 slash command 处理时直接传递 `[用户消息, meta消息]` 数组，而非使用 `steer()` 队列

**Tech Stack:** TypeScript, bun:test

---

## Task 1: 添加 AgentSession.prompt() 数组重载

**Files:**
- 修改: `src/agent/session.ts:159-176`
- 测试: `src/agent/__tests__/session.test.ts`

- [ ] **Step 1: 写测试 - prompt 接受 AgentMessage 数组**

```typescript
// src/agent/__tests__/session.test.ts
// 在现有测试文件末尾添加

it("should accept AgentMessage array in prompt()", async () => {
  const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
  const session = new AgentSession({
    cwd: "/tmp",
    model,
    apiKey: "test",
    systemPrompt: async () => asSystemPrompt([""]),
  });

  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    { role: "user", content: [{ type: "text", text: "meta content" }], timestamp: Date.now(), isMeta: true },
  ];

  // Mock agent.prompt to track calls
  const agent = (session as any).agent;
  const originalPrompt = agent.prompt;
  let calledWith: any = undefined;
  agent.prompt = async (msgs: any) => { calledWith = msgs; };

  await session.prompt(messages);

  expect(calledWith).toEqual(messages);
  expect(calledWith[1].isMeta).toBe(true);

  agent.prompt = originalPrompt;
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test src/agent/__tests__/session.test.ts --grep "should accept AgentMessage array"`
Expected: FAIL (prompt 重载尚未添加）

- [ ] **Step 3: 实现 AgentMessage[] 重载**

```typescript
// src/agent/session.ts:159-176
// 原来的 overload 声明和实现替换为：

/** 发送用户消息（消息数组，用于 meta message 注入） */
async prompt(messages: AgentMessage[]): Promise<void>;
/** 发送用户消息 */
async prompt(text: string): Promise<void>;
/** 发送用户消息（AgentMessage 格式） */
async prompt(message: AgentMessage): Promise<void>;
async prompt(textOrMessageOrArray: string | AgentMessage | AgentMessage[]): Promise<void> {
  // 确保 SkillTool 已注册完成，避免竞态条件
  if (this.skillToolInitPromise) {
    await this.skillToolInitPromise;
    this.skillToolInitPromise = null;
  }
  logger.info("Turn started", { model: this.agent.state.model.name });
  await this.refreshSystemPrompt();

  if (Array.isArray(textOrMessageOrArray)) {
    await this.agent.prompt(textOrMessageOrArray);
  } else if (typeof textOrMessageOrArray === "string") {
    await this.agent.prompt(textOrMessageOrArray);
  } else {
    await this.agent.prompt(textOrMessageOrArray);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test src/agent/__tests__/session.test.ts --grep "should accept AgentMessage array"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/session.ts src/agent/__tests__/session.test.ts
git commit -m "feat(session): add AgentMessage[] overload to prompt()

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 修改 app.tsx 使用数组调用

**Files:**
- 修改: `src/tui/app.tsx:53-83`
- 测试: 无（app.tsx 无现有测试，手动验证）

- [ ] **Step 1: 确认 app.tsx 当前实现**

```typescript
// src/tui/app.tsx:53-83 当前代码
if (result.handled) {
  // 显示用户输入
  appendUserMessage(trimmed);

  // 处理 meta 消息 - 使用 steer 加入队列，不触发立即响应
  if (result.metaMessages && result.metaMessages.length > 0) {
    for (const metaContent of result.metaMessages) {
      logger.debug("Steering meta message to LLM", { contentLength: metaContent.length });
      const metaMessage: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: metaContent }],
        timestamp: Date.now(),
        isMeta: true,
      };
      session.steer(metaMessage);  // ← 改为 session.prompt(messages)
    }
  }

  if (result.textResult) {
    appendSystemMessage(result.textResult);
  }
  return;  // ← 注意：原来这里直接 return，没有调用 session.prompt
}
```

- [ ] **Step 2: 修改为数组调用**

替换 `src/tui/app.tsx:61-77` 为：

```typescript
// 处理 meta 消息 - 使用 prompt 数组在同一 turn 发送
if (result.metaMessages && result.metaMessages.length > 0) {
  // 构建消息数组：用户输入 + meta messages
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: trimmed }], timestamp: Date.now() },
    ...result.metaMessages.map(
      (metaContent): AgentMessage => ({
        role: "user" as const,
        content: [{ type: "text" as const, text: metaContent }],
        timestamp: Date.now(),
        isMeta: true,
      }),
    ),
  ];
  session.prompt(messages);
} else {
  session.prompt(trimmed);
}
```

同时删除第 67-75 行的 `session.steer()` 相关代码。

- [ ] **Step 3: 手动验证**

由于 `src/tui/app.tsx` 无测试文件，需要手动验证：

1. 启动应用：`bun run src/index.ts`
2. 输入 `/brainstorming`
3. 确认 UI 显示 "/brainstorming" 但不显示 meta message
4. 确认 LLM 能响应（不是 "OK Skill" 后无响应）

- [ ] **Step 4: 提交**

```bash
git add src/tui/app.tsx
git commit -m "feat(app): send meta messages in same turn via prompt array

Replaces steer() with direct prompt([userMsg, ...metaMsgs]) call
so meta messages are injected in the same turn as user input.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 验证标准

1. 执行 `/brainstorming` 后，LLM 能在同一 turn 收到 skill 内容（不再出现 "OK Skill" 后无响应）
2. `isMeta: true` 的消息在 UI 中不显示（MessageList 过滤）
3. 原有 `session.prompt(text)` 调用继续正常工作
4. `bun test` 全部通过
