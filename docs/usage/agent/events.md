# Agent 事件

## 事件类型总览

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

## 生命周期事件

### agent_start

Agent 开始运行：

```typescript
{ type: "agent_start" }
```

### agent_end

Agent 结束运行：

```typescript
{ type: "agent_end"; messages: AgentMessage[] }
```

## Turn 事件

### turn_start

一个 turn 开始（一次 assistant 响应 + 工具调用）：

```typescript
{ type: "turn_start" }
```

### turn_end

一个 turn 结束：

```typescript
{ type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
```

## Message 事件

### message_start

消息开始：

```typescript
{ type: "message_start"; message: AgentMessage }
```

### message_update

消息更新（流式输出中的增量事件）：

```typescript
{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
```

### message_end

消息结束：

```typescript
{ type: "message_end"; message: AgentMessage }
```

## Tool 执行事件

### tool_execution_start

工具开始执行：

```typescript
{ type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
```

### tool_execution_update

工具执行更新（用于进度反馈）：

```typescript
{ type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
```

### tool_execution_end

工具执行结束：

```typescript
{ type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

## 订阅示例

```typescript
agent.subscribe((event, signal) => {
  switch (event.type) {
    case "agent_start":
      console.log("Agent 开始");
      break;
    case "agent_end":
      console.log("Agent 结束，共", event.messages.length, "条消息");
      break;
    case "turn_start":
      console.log("Turn 开始");
      break;
    case "turn_end":
      console.log("Turn 结束，stopReason:", event.message.stopReason);
      break;
    case "message_start":
      console.log("消息开始:", event.message.role);
      break;
    case "message_end":
      if (event.message.role === "assistant") {
        console.log("Assistant 回复:", event.message.content);
      }
      break;
    case "tool_execution_start":
      console.log("工具开始:", event.toolName);
      break;
    case "tool_execution_end":
      console.log("工具结束:", event.toolName, "isError:", event.isError);
      break;
  }
});
```

## signal 参数

订阅回调的第二个参数是当前运行的 AbortSignal：

```typescript
agent.subscribe((event, signal) => {
  // 检查是否已中止
  if (signal.aborted) {
    console.log("已中止");
    return;
  }

  // 监听中止事件
  signal.addEventListener("abort", () => {
    console.log("Agent 被中止");
  });
});
```
