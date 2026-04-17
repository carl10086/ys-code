# agent/types.ts 彻底规范化重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `src/agent/types.ts` 进行彻底的注释规范化，统一注释风格，补全缺失的中文注释，`TDetails` 类型约束从 `any` 改为 `unknown`。

**Architecture:** 仅文本注释改动，不改变任何类型、接口、导出顺序和代码结构。

**Tech Stack:** TypeScript

---

## 文件概览

- 修改: `src/agent/types.ts`

---

## Task 1: 规范化 ThinkingLevel 枚举值注释

**Files:**
- Modify: `src/agent/types.ts:57`

- [ ] **Step 1: 为 ThinkingLevel 枚举值添加中文注释**

将 `ThinkingLevel` 类型定义修改为：

```typescript
/** thinking 等级 */
export type ThinkingLevel =
  | "off"   // 不使用 thinking
  | "minimal"   // 极简 thinking，仅最终答案
  | "low"   // 低级别 thinking
  | "medium"   // 中等级别 thinking（平衡速度和深度）
  | "high"   // 高级别 thinking（更深入分析）
  | "xhigh";   // 极高 thinking（最深度推理）
```

---

## Task 2: 规范化 AgentTool 接口注释

**Files:**
- Modify: `src/agent/types.ts:71-84`

- [ ] **Step 1: 为 AgentTool.execute 各参数添加中文注释**

将 `AgentTool` 接口修改为：

```typescript
/** 工具定义 */
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  description: string;
  parameters: TParameters;
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  /** 执行工具
   * @param toolCallId 工具调用唯一标识
   * @param params 经过 prepareArguments 处理后的参数
   * @param signal 可选的 abort 信号
   * @param onUpdate 可选的进度回调
   */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

- [ ] **Step 2: 规范化 AgentToolResult 注释**

将 `AgentToolResult` 接口修改为：

```typescript
/** 工具执行结果
 * @template T 详细信息类型
 */
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

---

## Task 3: 规范化 AgentLoopConfig 字段注释

**Files:**
- Modify: `src/agent/types.ts:119-130`

- [ ] **Step 1: 为 AgentLoopConfig 每个字段添加详细注释**

将 `AgentLoopConfig` 接口修改为：

```typescript
/** AgentLoop 配置 */
export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;   // 使用的 AI 模型
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;   // 将 Agent 消息转换为 LLM 消息格式
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;   // 可选的消息转换/过滤函数
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;   // 可选的自定义 API Key 获取函数
  getSteeringMessages?: () => Promise<AgentMessage[]>;   // 可选的引导消息获取函数
  getFollowUpMessages?: () => Promise<AgentMessage[]>;   // 可选的后续消息获取函数
  toolExecution?: ToolExecutionMode;   // 工具执行模式（sequential/parallel）
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;   // 工具执行前的钩子，可阻止或修改行为
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;   // 工具执行后的钩子，可覆盖结果
}
```

---

## Task 4: 规范化 AgentEvent 类型注释

**Files:**
- Modify: `src/agent/types.ts:106-117`

- [ ] **Step 1: 为 AgentEvent union 内每个事件类型添加独立注释**

将 `AgentEvent` 类型修改为：

```typescript
/** Agent 事件类型 */
export type AgentEvent =
  | { type: "agent_start" }   // Agent 开始
  | { type: "agent_end"; messages: AgentMessage[] }   // Agent 结束
  | { type: "turn_start" }   // 轮次开始
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }   // 轮次结束
  | { type: "message_start"; message: AgentMessage }   // 消息开始
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }   // 消息更新
  | { type: "message_end"; message: AgentMessage }   // 消息结束
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }   // 工具执行开始
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }   // 工具执行进度更新
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };   // 工具执行结束
```

---

## Task 5: 规范化其他接口/类型注释

**Files:**
- Modify: `src/agent/types.ts:1-131`

- [ ] **Step 1: 检查并规范化所有导出接口的注释风格**

确保以下接口/类型的注释风格统一（使用 `/** 中文 */` 格式）：

- `StreamFn` - 流函数类型
- `ToolExecutionMode` - 工具执行模式
- `AgentToolCall` - Agent toolCall 类型
- `BeforeToolCallResult` - 阻止工具执行的结果
- `AfterToolCallResult` - afterToolCall 可覆盖的字段
- `BeforeToolCallContext` - beforeToolCall 上下文
- `AfterToolCallContext` - afterToolCall 上下文
- `CustomAgentMessages` - 自定义消息扩展接口
- `AgentMessage` - Agent 消息类型
- `AgentContext` - Agent 上下文快照
- `AgentState` - Agent 公开状态

---

## Task 6: 验证与提交

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: 运行 TypeScript 类型检查**

Run: `cd /Users/carlyu/soft/projects/ys-code && npx tsc --noEmit src/agent/types.ts`
Expected: 无错误输出

- [ ] **Step 2: 提交变更**

```bash
git add src/agent/types.ts
git commit -m "refactor(agent/types.ts): 彻底规范化注释风格，补全中文注释

- 为 ThinkingLevel 每个枚举值添加中文注释
- 为 AgentTool.execute 各参数添加 @param 注释
- 为 AgentLoopConfig 每个字段添加详细注释
- 为 AgentEvent union 内每个事件类型添加独立注释
- 将 TDetails 类型约束从 any 改为 unknown
- 统一注释风格为 /** 中文 */ 格式

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] 所有导出类型、接口、字段都有中文注释
- [ ] 注释风格统一为 `/** 中文 */` 格式
- [ ] `TDetails` 类型约束从 `any` 改为 `unknown`
- [ ] TypeScript 编译无错误
- [ ] git commit 成功
