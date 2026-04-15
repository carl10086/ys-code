# pi-mono Coding Agent SDK 使用分析

## 1. 创建 Session

### 1.1 基础用法

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession();

// 发送消息
await session.prompt("Hello, help me read package.json");

// 获取状态
console.log(session.state.messages.length);
console.log(session.isStreaming);
```

### 1.2 完整选项

```typescript
const { session, extensionsResult } = await createAgentSession({
  cwd: process.cwd(),           // 工作目录
  agentDir: "~/.pi/agent",      // 配置目录

  // 模型配置
  model: getModel("anthropic", "claude-opus-4-5"),
  thinkingLevel: "medium",
  scopedModels: [
    { model: model1, thinkingLevel: "high" },
    { model: model2 },
  ],

  // 工具配置
  tools: ["read", "bash", "edit", "write"],  // 默认
  customTools: [
    {
      name: "my_tool",
      label: "My Tool",
      description: "Does something",
      parameters: Type.Object({ ... }),
      execute: async (id, params) => ({ content: [], details: {} }),
    },
  ],

  // 扩展
  resourceLoader: customResourceLoader,
});
```

## 2. 消息发送

### 2.1 prompt

```typescript
// 发送消息并等待完成
await session.prompt("What files were modified?");

// 带选项
await session.prompt("Fix the bug", {
  expandPromptTemplates: true,  // 展开文件模板（默认 true）
  images: [{ type: "image", source: { type: "url", url: "..." } }],
  source: "interactive",        // 输入来源
});
```

### 2.2 steer（中断式队列）

当 Agent 正在运行时，插入消息到队列，在当前 turn 结束后、下一个 turn 开始前注入：

```typescript
// Agent 运行时
await session.prompt("Start a long task...");

// 在 streaming 期间添加 steer
session.steer("Stop, let me give you context");

// Agent 会立即处理这条消息
```

### 2.3 followUp（等待式队列）

当 Agent 空闲时添加消息，等待所有工具调用完成后注入：

```typescript
await session.prompt("Write tests for the new feature");

// 添加 followUp，等 Agent 完全停止后处理
await session.followUp("Now commit the changes");
```

### 2.4 sendUserMessage / sendCustomMessage

```typescript
// 发送用户消息
await session.sendUserMessage("Hello", { deliverAs: "steer" });

// 发送自定义消息（扩展用）
await session.sendCustomMessage({
  customType: "artifact",
  content: "...",
  display: true,
}, { triggerTurn: true });
```

## 3. 状态访问

```typescript
// 获取完整状态
const state = session.state;
console.log(state.messages);        // 所有消息
console.log(state.model);           // 当前模型
console.log(state.thinkingLevel);   // 当前 thinking 级别
console.log(state.isStreaming);      // 是否在运行
console.log(state.systemPrompt);     // 当前 system prompt

// 获取消息
const messages = session.messages;
const lastMessage = messages[messages.length - 1];
```

## 4. 工具管理

### 4.1 启用/禁用工具

```typescript
// 获取当前活跃工具
const activeTools = session.getActiveToolNames(); // ["read", "bash", "edit", "write"]

// 设置活跃工具
await session.setActiveToolsByName(["read", "bash"]);

// 获取所有可用工具
const allTools = session.getAllTools();
```

### 4.2 模型和 Thinking

```typescript
// 获取/设置模型
const model = session.model;
await session.setModel(newModel);

// 获取/设置 thinking 级别
const level = session.thinkingLevel;
await session.setThinkingLevel("high");

// 循环切换
const newLevel = session.cycleThinkingLevel();

// 获取支持的级别
const available = session.getAvailableThinkingLevels(); // ["off", "minimal", "low", "medium", "high"]
```

## 5. 事件订阅

```typescript
// 订阅 Agent 事件
const unsubscribe = session.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      console.log("Agent started");
      break;
    case "agent_end":
      console.log("Agent ended");
      break;
    case "turn_start":
      console.log("Turn started");
      break;
    case "turn_end":
      console.log("Turn ended, stopReason:", event.message.stopReason);
      break;
    case "message_start":
      console.log("Message:", event.message.role);
      break;
    case "tool_execution_start":
      console.log("Tool:", event.toolName, event.args);
      break;
    case "tool_execution_end":
      console.log("Tool done:", event.toolName, event.isError);
      break;
  }
});

// 取消订阅
unsubscribe();
```

## 6. Session 管理

```typescript
// 获取 session 信息
console.log(session.sessionId);    // 当前 session ID
console.log(session.sessionFile);   // session 文件路径
console.log(session.sessionName);   // 显示名称（如果有）

// 设置显示名称
session.setSessionName("My Session");

// 获取统计
const stats = session.getSessionStats();
console.log(stats.userMessages);   // 用户消息数
console.log(stats.tokens.total);    // 总 token 数
console.log(stats.cost);            // 总费用
```

## 7. 树导航

```typescript
// 获取分支信息
const userMessages = session.getUserMessagesForForking();
// [{ entryId: "xxx", text: "Hello..." }, ...]

// 导航到指定 entry
await session.navigateTree(targetId, {
  summarize: true,                 // 摘要放弃的分支
  customInstructions: "Focus on...",
});

// 创建分支
await session.fork(targetId);
```

## 8. 上下文压缩

```typescript
// 手动压缩
const result = await session.compact();
// {
//   summary: "用户讨论了 X，功能 Y 被添加...",
//   firstKeptEntryId: "entry_id",
//   tokensBefore: 50000,
// }

// 检查是否正在压缩
console.log(session.isCompacting);

// 取消压缩
session.abortCompaction();
```

## 9. 自动重试

```typescript
// 检查重试状态
console.log(session.isRetrying);        // 是否正在重试
console.log(session.autoRetryEnabled);   // 自动重试是否启用

// 控制自动重试
session.setAutoRetryEnabled(false);

// 获取重试次数
console.log(session.retryAttempt);
```

## 10. Bash 执行

```typescript
// 直接执行 bash（不通过 Agent）
const result = await session.executeBash("ls -la", (chunk) => {
  process.stdout.write(chunk);
});

// 结果记录到 session 历史
session.recordBashResult("ls -la", result);

// 检查 bash 状态
console.log(session.isBashRunning);          // bash 是否在运行
console.log(session.hasPendingBashMessages); // 是否有待处理结果

// 取消 bash
session.abortBash();
```

## 11. 扩展绑定

```typescript
// 绑定扩展 UI
await session.bindExtensions({
  uiContext: { /* ExtensionUIContext 实现 */ },
  commandContextActions: { /* 命令上下文 */ },
  shutdownHandler: () => process.exit(0),
  onError: (err) => console.error("Extension error:", err),
});
```
