# Skill Meta Message 同一 Turn 注入方案

## 概述

解决 slash command 执行后 meta message 无法在当前 turn 送达 LLM 的问题。

## 问题根因

| 系统 | 机制 | 表现 |
|------|------|------|
| CC | `onQuery([userMsg, metaMsg1, metaMsg2])` | 多消息同一 turn 处理 |
| ys-code | `session.prompt(text)` + `session.steer(meta)` | steer 在下一 turn 才注入 |

## 目标

让 meta message 与用户输入在**同一个 turn** 发送给 LLM。

## 方案 A：扩展 session.prompt() 支持消息数组

### 架构

```
app.tsx                           session.ts                        agent.ts
   │                                 │                                 │
   │  session.prompt([               │                                 │
   │    userMsg,                     │                                 │
   │    {isMeta: true, ...}         │                                 │
   │  ])                            │                                 │
   │ ─────────────────────────────► │                                 │
   │                                 │  agent.prompt([...])            │
   │                                 │ ─────────────────────────────►  │
   │                                 │                                 │ runAgentLoop
   │                                 │                                 │    │
   │                                 │                                 │    ▼
```

### 实施步骤（TDD）

#### Step 1: 添加 AgentSession.prompt() 重载

**测试文件**: `src/agent/session.test.ts`

```typescript
// 伪代码 - 测试用例
test("prompt should accept AgentMessage array", async () => {
  const session = createTestSession();
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    { role: "user", content: [{ type: "text", text: "meta" }], timestamp: Date.now(), isMeta: true },
  ];

  await session.prompt(messages);

  // 验证调用了 agent.prompt 且参数为数组
  expect(agent.prompt).toHaveBeenCalledWith(messages);
});
```

**实现文件**: `src/agent/session.ts:160-176`

```typescript
/** 发送用户消息（消息数组） */
async prompt(messages: AgentMessage[]): Promise<void>;
/** 发送用户消息 */
async prompt(text: string): Promise<void>;
/** 发送用户消息（AgentMessage 格式） */
async prompt(message: AgentMessage): Promise<void>;
async prompt(textOrMessageOrArray: string | AgentMessage | AgentMessage[]): Promise<void> {
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

#### Step 2: 修改 app.tsx 调用方式

**测试文件**: `src/tui/app.test.tsx`（如存在）

```typescript
// 伪代码 - 测试用例
test("slash command should send meta message in same turn", async () => {
  const { session, appendUserMessage } = setupTest();
  const executeCommand = jest.fn().mockResolvedValue({
    handled: true,
    metaMessages: ["<skill>content</skill>"],
  });

  await handleSubmit("/brainstorming");

  // 验证 prompt 被调用，且第二个消息 isMeta: true
  expect(session.prompt).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ isMeta: true }),
    ])
  );
});
```

**实现文件**: `src/tui/app.tsx:53-83`

```typescript
// 原来：
if (result.handled) {
  appendUserMessage(trimmed);
  if (result.metaMessages && result.metaMessages.length > 0) {
    for (const metaContent of result.metaMessages) {
      session.steer(metaMessage);  // 删除
    }
  }
  // ...
  session.prompt(trimmed);  // 删除
}

// 改为：
if (result.handled) {
  appendUserMessage(trimmed);

  if (result.metaMessages && result.metaMessages.length > 0) {
    // 构建消息数组：用户输入 + meta messages
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: trimmed }], timestamp: Date.now() },
      ...result.metaMessages.map((metaContent): AgentMessage => ({
        role: "user" as const,
        content: [{ type: "text" as const, text: metaContent }],
        timestamp: Date.now(),
        isMeta: true,
      })),
    ];
    session.prompt(messages);
  } else {
    session.prompt(trimmed);
  }
  return;
}
```

### 关键类型定义

```typescript
// src/agent/types.ts
interface AgentMessage {
  role: "user" | "assistant" | "system" | "toolResult";
  content: ContentBlock[];
  timestamp?: number;
  isMeta?: boolean;  // 已存在
  // ...
}
```

### 影响范围

| 文件 | 改动类型 |
|------|----------|
| `src/agent/session.ts` | 添加重载 |
| `src/tui/app.tsx` | 修改调用逻辑 |

### 约束

1. 不修改 `steer()` 机制
2. 不修改 `Agent.prompt()` 已有数组支持
3. 现有普通消息流程不受影响

## 验证标准

1. 执行 `/brainstorming` 后，LLM 能在同一 turn 收到 skill 内容
2. `isMeta: true` 的消息在 UI 中不显示，但发送给 LLM
3. 原有 `session.prompt(text)` 调用继续正常工作
