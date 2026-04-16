# agent.ts 注释规范化重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `src/agent/agent.ts` 进行彻底的注释规范化，统一注释风格，补全缺失的中文注释。

**Architecture:** 仅文本注释改动，不改变任何类型、接口、类结构、方法和代码逻辑。

**Tech Stack:** TypeScript

---

## 文件概览

- 修改: `src/agent/agent.ts`

---

## Task 1: 为类型定义添加中文注释

**Files:**
- Modify: `src/agent/agent.ts:56-64`

- [ ] **Step 1: 为 QueueMode 类型添加中文注释**

将 `type QueueMode = "all" | "one-at-a-time";` 修改为：

```typescript
/** 队列模式 */
type QueueMode = "all" | "one-at-a-time";
```

- [ ] **Step 2: 为 MutableAgentState 类型添加中文注释**

将 `type MutableAgentState = ...` 修改为：

```typescript
/** 可变 Agent 状态 */
type MutableAgentState = Omit<AgentState, "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};
```

- [ ] **Step 3: 为 ActiveRun 类型添加中文注释**

将 `type ActiveRun = ...` 修改为：

```typescript
/** 活动运行状态 */
type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};
```

---

## Task 2: 为 PendingMessageQueue 类添加中文注释

**Files:**
- Modify: `src/agent/agent.ts:94-125`

- [ ] **Step 1: 为 PendingMessageQueue 类添加中文注释**

将 `class PendingMessageQueue { ... }` 修改为：

```typescript
/** 待处理消息队列 */
class PendingMessageQueue {
  private messages: AgentMessage[] = [];

  /** @param mode 队列模式 */
  constructor(public mode: QueueMode) {}

  /** 入队消息
   * @param message 要添加的消息
   */
  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  /** 检查队列是否有消息
   * @returns 是否有待处理消息
   */
  hasItems(): boolean {
    return this.messages.length > 0;
  }

  /** 出队消息
   * @returns 消息数组，模式为 all 时返回全部，one-at-a-time 时返回一条
   */
  drain(): AgentMessage[] {
    if (this.mode === "all") {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }

    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  /** 清空队列 */
  clear(): void {
    this.messages = [];
  }
}
```

---

## Task 3: 为 AgentOptions 接口添加中文注释

**Files:**
- Modify: `src/agent/agent.ts:133-156`

- [ ] **Step 1: 为 AgentOptions 接口添加中文注释**

将 `export interface AgentOptions { ... }` 修改为：

```typescript
/** Agent 构造选项 */
export interface AgentOptions {
  /** 初始状态 */
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  /** 将 Agent 消息转换为 LLM 消息格式 */
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** 可选的消息转换/过滤函数 */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  /** 流函数 */
  streamFn?: StreamFn;
  /** 可选的自定义 API Key 获取函数 */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /** 载荷回调 */
  onPayload?: SimpleStreamOptions["onPayload"];
  /** 工具执行前的钩子 */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /** 工具执行后的钩子 */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  /** 引导模式 */
  steeringMode?: QueueMode;
  /** 后续消息模式 */
  followUpMode?: QueueMode;
  /** 会话 ID */
  sessionId?: string;
  /** thinking 预算 */
  thinkingBudgets?: ThinkingBudgets;
  /** 传输类型 */
  transport?: Transport;
  /** 最大重试延迟（毫秒） */
  maxRetryDelayMs?: number;
  /** 工具执行模式 */
  toolExecution?: ToolExecutionMode;
}
```

---

## Task 4: 为 Agent 类及其方法添加中文注释

**Files:**
- Modify: `src/agent/agent.ts:161-520`

- [ ] **Step 1: 为 Agent 类添加中文注释**

将 `export class Agent { ... }` 的类注释修改为：

```typescript
/**
 * Stateful Agent wrapper around the low-level agent loop.
 * 状态化 Agent，封装底层 agent loop
 */
export class Agent {
```

- [ ] **Step 2: 为 Agent 公开属性添加中文注释**

将 `Agent` 类内的公开属性修改为：

```typescript
  /** 将 Agent 消息转换为 LLM 消息格式 */
  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** 可选的消息转换/过滤函数 */
  public transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  /** 流函数 */
  public streamFn: StreamFn;
  /** 可选的自定义 API Key 获取函数 */
  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /** 载荷回调 */
  public onPayload?: SimpleStreamOptions["onPayload"];
  /** 工具执行前的钩子 */
  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /** 工具执行后的钩子 */
  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  /** 会话 ID */
  public sessionId?: string;
  /** thinking 预算 */
  public thinkingBudgets?: ThinkingBudgets;
  /** 传输类型 */
  public transport: Transport;
  /** 最大重试延迟（毫秒） */
  public maxRetryDelayMs?: number;
  /** 工具执行模式 */
  public toolExecution: ToolExecutionMode;
```

- [ ] **Step 3: 为 subscribe 方法添加中文注释**

将 `subscribe` 方法修改为：

```typescript
  /**
   * 订阅 agent 生命周期事件
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
```

- [ ] **Step 4: 为 state getter 添加中文注释**

将 `get state()` 修改为：

```typescript
  /**
   * 当前 agent 状态
   */
  get state(): AgentState {
```

- [ ] **Step 5: 为 steeringMode 属性添加中文注释**

将 `steeringMode` getter/setter 修改为：

```typescript
  /** 引导队列模式 */
  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  /** @returns 引导队列模式 */
  get steeringMode(): QueueMode {
```

- [ ] **Step 6: 为 followUpMode 属性添加中文注释**

将 `followUpMode` getter/setter 修改为：

```typescript
  /** 后续消息队列模式 */
  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  /** @returns 后续消息队列模式 */
  get followUpMode(): QueueMode {
```

- [ ] **Step 7: 为 steer/followUp/clear 方法添加中文注释**

将 `steer`, `followUp`, `clearSteeringQueue`, `clearFollowUpQueue`, `clearAllQueues`, `hasQueuedMessages` 方法修改为：

```typescript
  /** 入队引导消息，在当前 assistant turn 结束后注入 */
  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  /** 入队后续消息，仅在 agent 停止后运行 */
  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  /** 清空引导队列 */
  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  /** 清空后续队列 */
  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  /** 清空所有队列 */
  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  /** 检查是否有队列消息
   * @returns 是否有待处理消息
   */
  hasQueuedMessages(): boolean {
```

- [ ] **Step 8: 为 signal 和 abort 方法添加中文注释**

将 `signal` getter 和 `abort` 方法修改为：

```typescript
  /**
   * 当前运行的 abort 信号
   */
  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  /** 中止当前运行 */
  abort(): void {
```

- [ ] **Step 9: 为 waitForIdle 和 reset 方法添加中文注释**

将 `waitForIdle` 和 `reset` 方法修改为：

```typescript
  /**
   * 等待当前运行和所有事件监听器完成
   */
  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  /** 重置 transcript 状态、运行时状态和队列消息 */
  reset(): void {
```

- [ ] **Step 10: 为 prompt 方法添加中文注释**

将 `prompt` 方法修改为：

```typescript
  /**
   * 从文本、单个消息或消息批次开始新 prompt
   * @param input 字符串或消息
   * @param images 可选的图片内容
   */
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
```

- [ ] **Step 11: 为 continue 方法添加中文注释**

将 `continue` 方法修改为：

```typescript
  /**
   * 从当前 transcript 继续。最后一条消息必须是 user 或 tool-result 消息。
   */
  async continue(): Promise<void> {
```

- [ ] **Step 12: 为 private 方法添加中文注释**

将所有 private 方法修改为：

```typescript
  /** 标准化 prompt 输入为消息数组 */
  private normalizePromptInput(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): AgentMessage[] {

  /** 运行 prompt 消息 */
  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {

  /** 继续运行 */
  private async runContinuation(): Promise<void> {

  /** 创建上下文快照 */
  private createContextSnapshot(): AgentContext {

  /** 创建循环配置 */
  private createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {

  /** 使用生命周期管理运行 */
  private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {

  /** 处理运行失败 */
  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {

  /** 完成运行 */
  private finishRun(): void {

  /** 处理事件 */
  private async processEvents(event: AgentEvent): Promise<void> {
```

---

## Task 5: 验证与提交

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: 运行 TypeScript 类型检查**

Run: `cd /Users/carlyu/soft/projects/ys-code && npx tsc --noEmit src/agent/agent.ts`
Expected: 无错误输出

- [ ] **Step 2: 提交变更**

```bash
git add src/agent/agent.ts
git commit -m "refactor(agent.ts): 彻底规范化注释风格，补全中文注释

- 为 QueueMode/MutableAgentState/ActiveRun 类型添加中文注释
- 为 PendingMessageQueue 类添加中文注释
- 为 AgentOptions 接口所有字段添加中文注释
- 为 Agent 类添加中文注释
- 为所有 public/private 方法添加中文注释
- 统一注释风格为 /** 中文 */ 格式

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] 所有类型定义都有中文注释
- [ ] 所有类、接口都有中文注释
- [ ] 所有方法、字段都有中文注释
- [ ] 注释风格统一为 `/** 中文 */` 格式
- [ ] TypeScript 编译无错误
- [ ] git commit 成功
