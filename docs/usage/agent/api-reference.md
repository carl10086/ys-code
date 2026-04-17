# Agent API 参考

## Agent 类

### 构造函数

```typescript
const agent = new Agent(options?: AgentOptions);
```

### AgentOptions

```typescript
interface AgentOptions {
  // 初始状态
  initialState?: Partial<AgentState>;

  // 消息转换函数（AgentMessage[] → Message[]）
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  // 上下文预处理
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  // 自定义流函数
  streamFn?: StreamFn;

  // API Key 获取函数
  getApiKey?: (provider: string) => string | undefined;

  // Payload 回调
  onPayload?: (payload: unknown, model: Model) => unknown | undefined;

  // Tool 执行钩子
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;

  // 队列模式
  steeringMode?: QueueMode;   // "all" | "one-at-a-time"
  followUpMode?: QueueMode;    // "all" | "one-at-a-time"

  // 会话 ID
  sessionId?: string;

  // Thinking 配置
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;  // "sequential" | "parallel"
}
```

### 实例方法

#### prompt()

发送 prompt 到 agent：

```typescript
// 字符串
await agent.prompt("What is 2 + 2?");

// 单条消息
await agent.prompt({ role: "user", content: "Hello", timestamp: Date.now() });

// 消息数组
await agent.prompt([
  { role: "user", content: "Hello", timestamp: Date.now() },
  { role: "assistant", content: [...], timestamp: Date.now() },
]);

// 带图片
await agent.prompt("What is in this image?", [imageContent]);
```

#### continue()

继续当前对话（从上次结束的地方继续）：

```typescript
await agent.continue();
```

#### subscribe()

订阅 agent 事件：

```typescript
const unsubscribe = agent.subscribe((event, signal) => {
  if (event.type === "message_end") {
    console.log("Message ended:", event.message);
  }
});

// 取消订阅
unsubscribe();
```

#### abort()

中止当前运行：

```typescript
agent.abort();
```

#### waitForIdle()

等待当前运行完成：

```typescript
await agent.waitForIdle();
```

#### reset()

重置 agent 状态：

```typescript
agent.reset();
```

#### steer()

插入 steering 消息（在当前 turn 结束后执行）：

```typescript
agent.steer({ role: "user", content: "Actually, check the weather too", timestamp: Date.now() });
```

#### followUp()

插入 follow-up 消息（在 agent 结束时执行）：

```typescript
agent.followUp({ role: "user", content: "Thanks! One more question...", timestamp: Date.now() });
```

#### clearSteeringQueue() / clearFollowUpQueue()

清空队列：

```typescript
agent.clearSteeringQueue();
agent.clearFollowUpQueue();
agent.clearAllQueues();
```

### 实例属性

#### state

获取当前 agent 状态：

```typescript
console.log(agent.state.messages);      // 所有消息
console.log(agent.state.tools);         // 所有工具
console.log(agent.state.model);         // 当前模型
console.log(agent.state.isStreaming);   // 是否正在流式输出
console.log(agent.state.streamingMessage); // 当前流式消息
console.log(agent.state.pendingToolCalls); // 正在执行的工具
console.log(agent.state.errorMessage);  // 错误信息
```

#### signal

获取当前 abort signal：

```typescript
agent.signal; // AbortSignal | undefined
```

### QueueMode

```typescript
type QueueMode = "all" | "one-at-a-time";

// "all" - 一次取出所有消息
// "one-at-a-time" - 每次取一条
```

### ToolExecutionMode

```typescript
type ToolExecutionMode = "sequential" | "parallel";

// "sequential" - 顺序执行工具
// "parallel" - 并行执行工具
```
