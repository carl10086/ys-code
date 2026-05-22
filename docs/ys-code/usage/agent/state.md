# 状态管理

## AgentState 结构

```typescript
interface AgentState {
  systemPrompt: string;                    // 系统提示词
  model: Model<any>;                     // 当前模型
  thinkingLevel: ThinkingLevel;            // thinking 等级
  tools: AgentTool<any>[];                // 工具列表
  messages: AgentMessage[];                // 消息历史
  readonly isStreaming: boolean;           // 是否正在流式输出
  readonly streamingMessage?: AgentMessage; // 当前流式消息
  readonly pendingToolCalls: ReadonlySet<string>; // 正在执行的工具 ID
  readonly errorMessage?: string;           // 最近错误信息
}
```

## 读取状态

```typescript
console.log(agent.state.messages);       // 所有消息
console.log(agent.state.tools);          // 所有工具
console.log(agent.state.model);           // 当前模型
console.log(agent.state.isStreaming);     // 是否在运行中
```

## 修改状态

### systemPrompt

```typescript
agent.state.systemPrompt = "You are now a coding assistant.";
```

### model

```typescript
import { getModel } from "../../src/core/ai/index.js";
agent.state.model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
```

### thinkingLevel

```typescript
agent.state.thinkingLevel = "high";  // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
```

### tools

```typescript
// 添加工具
agent.state.tools = [...agent.state.tools, newTool];

// 移除工具
agent.state.tools = agent.state.tools.filter(t => t.name !== "unused_tool");
```

### messages

```typescript
// 添加消息
agent.state.messages = [...agent.state.messages, newMessage];

// 清空历史
agent.state.messages = [];

// 注意：也可以直接 push，但会创建新数组
agent.state.messages.push(newMessage);  // 效果同上
```

## Copy-on-Write 行为

Agent 对 `tools` 和 `messages` 使用 copy-on-write 模式：

```typescript
// 读取返回原数组引用
const tools = agent.state.tools;
const messages = agent.state.messages;

// 赋值会复制新数组
agent.state.tools = newTools;  // 不会影响原有数组
```

## 只读属性

### isStreaming

```typescript
if (agent.state.isStreaming) {
  console.log("Agent is running, please wait...");
}
```

### streamingMessage

```typescript
if (agent.state.streamingMessage) {
  console.log("Current streaming message:", agent.state.streamingMessage);
}
```

### pendingToolCalls

```typescript
console.log("Running tools:", agent.state.pendingToolCalls.size);
for (const id of agent.state.pendingToolCalls) {
  console.log(" - ", id);
}
```

### errorMessage

```typescript
if (agent.state.errorMessage) {
  console.error("Last error:", agent.state.errorMessage);
}
```

## reset() 方法

完全重置 agent 状态：

```typescript
agent.reset();

// 等同于：
// - messages = []
// - isStreaming = false
// - streamingMessage = undefined
// - pendingToolCalls = empty
// - errorMessage = undefined
// - 清空所有队列
```

## 状态与事件的关系

```typescript
agent.subscribe((event) => {
  switch (event.type) {
    case "message_end":
      // 此时 state.messages 已更新
      console.log("Total messages:", agent.state.messages.length);
      break;
    case "tool_execution_start":
      // 此时 state.pendingToolCalls 已更新
      console.log("Pending:", agent.state.pendingToolCalls.size);
      break;
    case "turn_end":
      // 检查是否有错误
      if (event.message.errorMessage) {
        console.log("Error:", event.message.errorMessage);
      }
      break;
  }
});
```
