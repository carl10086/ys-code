# Subagent P1 对齐迭代设计文档

## 1. Objective（目标）

基于 CC Diff 分析的 P1 对齐缺口，对现有 subagent MVP 实现进行三项增强，提升子代理的可靠性、可控性和可观测性。

**P1 缺口与目标映射：**

| 缺口 | 当前行为 | 目标行为 |
|------|----------|----------|
| 结果提取过于简单 | 仅取最后一条 assistant 文本，多轮工具调用后可能丢失信息 | 遍历完整消息历史，智能提取最有价值的响应内容 |
| 工具池无权限隔离 | 子代理继承父代理全部工具 | 子代理按配置获得过滤后的工具子集 |
| 执行过程黑盒不可观察 | `prompt()` → `waitForIdle()` 完全阻塞，无中间反馈 | 支持逐消息 yield，外部可订阅执行过程 |

**非目标：**
- 不引入异步后台执行（仍为 P2）
- 不引入 Agent 定义目录（仍为 P2）
- 不引入 worktree/remote 隔离（仍为 P2）
- 不修改现有同步阻塞执行语义

## 2. Commands（命令）

无新增 CLI 命令。所有改动为内部 API 调整。

## 3. Project Structure（项目结构）

```
src/agent/
  subagent/
    create-subagent.ts          # 修改：支持 tools filter + 可选 systemPrompt 继承
    create-subagent.test.ts     # 修改：补充工具过滤测试
    extract-result.ts           # 新增：子代理结果提取器
    extract-result.test.ts      # 新增：结果提取测试
  tools/
    agent-tool.ts               # 修改：逐消息 yield + 结果提取策略切换
    agent-tool.test.ts          # 修改：补充可观察性 + 结果提取测试
```

## 4. Code Style（代码风格）

- 遵循现有 `src/agent/tools/` 目录下工具定义模式
- 新增模块使用纯函数，不依赖闭包状态
- 保持 `AgentTool.execute` 签名兼容（返回值不变，内部增强）
- 测试保持 Arrange-Act-Assert 结构，每个测试单一断言

## 5. Design（详细设计）

### 5.1 增强结果提取策略

#### 5.1.1 问题分析

当前实现 `agent-tool.ts:64-76`：

```typescript
const lastAssistant = messages.findLast((m) => m.role === "assistant");
const text = lastAssistant.content
  .filter(isTextContent)
  .map((c) => c.text)
  .join("");
```

**缺陷场景：**

```
子代理对话历史：
  assistant: "我来帮你查找文件"          ← toolCall: Grep
  toolResult: Grep 结果
  assistant: "找到了，让我读取内容"       ← toolCall: Read
  toolResult: Read 结果
  assistant: "内容已读取"                ← toolCall: Write  (最后一条，但无实质结论)
```

最后一条 assistant 可能只是中间步骤的确认，而非完整结论。

#### 5.1.2 新策略：结构化结果提取

新增 `extract-result.ts`，实现三级提取策略：

```typescript
export interface ExtractResultOptions {
  /** 提取模式 */
  mode?: "lastText" | "allAssistantText" | "smart";
  /** 最大消息回溯数 */
  maxMessages?: number;
}

export interface ExtractedResult {
  /** 提取的文本 */
  text: string;
  /** 是否包含 toolCall */
  hasToolCalls: boolean;
  /** 提取来源消息数 */
  sourceMessageCount: number;
}

export function extractSubagentResult(
  messages: AgentMessage[],
  options: ExtractResultOptions = {},
): ExtractedResult;
```

**三级模式：**

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `lastText` | 取最后一条 assistant 的文本内容（与当前行为一致） | 简单对话 |
| `allAssistantText` | 合并所有 assistant 消息的文本，按时间顺序 | 多轮分析 |
| `smart`（默认） | 优先取最后一条包含文本的 assistant；若其内容过短（<20字符）且无实质信息，向前回溯到上一条有实质内容的 assistant | 工具调用链 |

**smart 模式算法：**

```
1. 从 messages 末尾向前扫描
2. 找到最后一条 role === "assistant" 的消息
3. 提取其 text content，计算有效字符数（去除空白和标点）
4. 若有效字符数 >= 20，返回该消息文本
5. 若 < 20，继续向前扫描上一条 assistant 消息
6. 重复步骤 3-5，直到找到满足条件的消息或扫描完所有消息
7. 若仍未找到，返回所有 assistant 文本的合并（兜底）
```

#### 5.1.3 集成点

`agent-tool.ts` 修改：

```typescript
import { extractSubagentResult } from "../subagent/extract-result.js";

// execute 方法中替换现有提取逻辑
const { text } = extractSubagentResult(child.state.messages, { mode: "smart" });
return { result: text || "No text response from subagent" };
```

### 5.2 工具池权限隔离

#### 5.2.1 问题分析

当前 `create-subagent.ts:30` 仅过滤 `AGENT_TOOL_NAME`，子代理继承父代理全部工具。这导致：
- 子代理可能调用与任务无关的工具（如 Read 工具被用于不应访问文件的任务）
- 无法按任务类型限制子代理能力范围
- 与 CC 的 `resolveAgentTools()` 策略不对齐

#### 5.2.2 新增：子代理工具过滤配置

扩展 `createSubagent` 参数：

```typescript
export interface CreateSubagentOptions {
  /** 允许的工具名称列表，undefined 表示继承全部 */
  allowedToolNames?: string[];
  /** 显式覆盖系统提示词 */
  systemPrompt?: (context: AgentInput) => Promise<SystemPrompt>;
}

export function createSubagent(
  parentAgent: Agent,
  options?: CreateSubagentOptions,
): Agent;
```

**过滤逻辑：**

```typescript
const tools = options?.allowedToolNames
  ? parentState.tools.filter((t) =>
      options.allowedToolNames!.includes(t.name) && t.name !== AGENT_TOOL_NAME
    )
  : parentState.tools.filter((t) => t.name !== AGENT_TOOL_NAME);
```

#### 5.2.3 AgentTool 传入过滤配置

`agent-tool.ts` 新增描述字段注入（类似 CC 的 tool-specific guidance）：

```typescript
description: `Launch a new subagent to handle a specific task...

Available tools for the subagent: ${getAvailableToolNames(parentAgent).join(", ")}`
```

#### 5.2.4 集成点

`agent-tool.ts` execute 方法：

```typescript
const child = createSubagent(parentAgent, {
  // 默认继承全部（保持向后兼容）
  // 未来可通过 AgentTool 参数传入 allowedToolNames
});
```

### 5.3 支持子代理执行过程可观察

#### 5.3.1 问题分析

当前 `agent-tool.ts:56`：`await child.prompt(params.prompt); await child.waitForIdle();` — 完全阻塞黑盒。

#### 5.3.2 新增：子代理事件流

新增 `SubagentEvent` 类型和事件订阅机制：

```typescript
export type SubagentEvent =
  | { type: "turn_start"; turnCount: number }
  | { type: "assistant_message"; message: AssistantMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; isError: boolean }
  | { type: "turn_end"; turnCount: number }
  | { type: "completed"; result: string }
  | { type: "error"; error: string };
```

#### 5.3.3 Agent 类增强

`Agent` 类新增 `subscribeToEvents()` 方法：

```typescript
export class Agent {
  private subagentEventListeners = new Set<(event: SubagentEvent) => void>();

  /** 订阅子代理事件（仅限内部使用） */
  subscribeToEvents(listener: (event: SubagentEvent) => void): () => void {
    this.subagentEventListeners.add(listener);
    return () => this.subagentEventListeners.delete(listener);
  }

  private emitSubagentEvent(event: SubagentEvent): void {
    for (const listener of this.subagentEventListeners) {
      listener(event);
    }
  }
}
```

在 `processEvents` 中转发关键事件：

```typescript
private async processEvents(event: AgentEvent): Promise<void> {
  // ... 现有逻辑 ...

  // 转发为 SubagentEvent
  switch (event.type) {
    case "turn_start":
      this.emitSubagentEvent({ type: "turn_start", turnCount: /* 需追踪 */ });
      break;
    case "message_end":
      if (event.message.role === "assistant") {
        this.emitSubagentEvent({ type: "assistant_message", message: event.message });
      }
      break;
    case "tool_execution_start":
      this.emitSubagentEvent({
        type: "tool_execution_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      break;
    case "tool_execution_end":
      this.emitSubagentEvent({
        type: "tool_execution_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      });
      break;
    case "agent_end":
      this.emitSubagentEvent({ type: "completed", result: /* 从 state 提取 */ });
      break;
  }
}
```

#### 5.3.4 AgentTool 集成

`agent-tool.ts` execute 方法利用 `onUpdate` 回调：

```typescript
async execute(_toolCallId, params, context, onUpdate?) {
  // ... 现有逻辑 ...

  // 订阅子代理事件
  const unsubscribe = child.subscribeToEvents((event) => {
    if (event.type === "assistant_message" && onUpdate) {
      // 将子代理进度反馈给父代理
      onUpdate({ partialResult: event.message });
    }
  });

  try {
    await child.prompt(params.prompt);
    await child.waitForIdle();
  } finally {
    unsubscribe();
  }

  // ... 结果提取 ...
}
```

#### 5.3.5 简化版：直接复用 onUpdate

为避免过度修改 Agent 类，采用简化方案：在 `agent-tool.ts` 中通过 `Agent.subscribe()` 监听事件并转发给 `onUpdate`：

```typescript
const unsubscribe = child.subscribe((event) => {
  if (event.type === "message_end" && event.message.role === "assistant" && onUpdate) {
    onUpdate({ partialResult: extractTextFromMessage(event.message) });
  }
});
```

**采用简化版。** `Agent.subscribe()` 已存在，无需新增 `SubagentEvent` 类型。只需在 `agent-tool.ts` 中订阅并转发。

### 5.4 修改汇总

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/agent/subagent/extract-result.ts` | 新增 | 三级结果提取策略 |
| `src/agent/subagent/extract-result.test.ts` | 新增 | 结果提取单元测试 |
| `src/agent/subagent/create-subagent.ts` | 修改 | 支持 `allowedToolNames` 和 `systemPrompt` 选项 |
| `src/agent/subagent/create-subagent.test.ts` | 修改 | 补充工具过滤测试 |
| `src/agent/tools/agent-tool.ts` | 修改 | 使用 extractSubagentResult + 订阅子代理事件转发 onUpdate |
| `src/agent/tools/agent-tool.test.ts` | 修改 | 补充 smart 提取、事件转发测试 |

## 6. Testing Strategy（测试策略）

### 6.1 单元测试

**extract-result.test.ts：**

| # | 测试内容 | 期望 |
|---|----------|------|
| 1 | `smart` 模式取最后一条有实质内容的 assistant | 返回内容最长的 assistant 文本 |
| 2 | `smart` 模式最后一条内容过短（<20字符）时回溯 | 返回上一条有实质内容的 assistant |
| 3 | `lastText` 模式与现有行为一致 | 返回最后一条 assistant 文本 |
| 4 | `allAssistantText` 模式合并所有文本 | 返回所有 assistant 文本拼接 |
| 5 | 无 assistant 消息时返回空字符串 | `text === ""` |
| 6 | assistant 消息只有 toolCall 无文本时 | 向前回溯或返回空字符串 |

**create-subagent.test.ts（新增）：**

| # | 测试内容 | 期望 |
|---|----------|------|
| 7 | `allowedToolNames` 过滤工具列表 | 子代理仅包含指定工具 + 递归 AgentTool |
| 8 | `allowedToolNames` 排除 AGENT_TOOL_NAME | 即使传入 "Agent" 也过滤掉 |
| 9 | `systemPrompt` 覆盖父代理系统提示 | 子代理使用传入的系统提示 |

**agent-tool.test.ts（新增）：**

| # | 测试内容 | 期望 |
|---|----------|------|
| 10 | `onUpdate` 收到子代理 assistant 消息 | `onUpdate` 被调用，参数包含文本 |
| 11 | smart 提取多轮工具调用后的结果 | 返回有实质内容的 assistant 文本 |
| 12 | 子代理无文本回复时返回回退字符串 | `result === "No text response from subagent"` |

### 6.2 回归测试

运行现有测试确保无破坏：
- `agent-tool.test.ts` 全部 14 个现有测试通过
- `create-subagent.test.ts` 全部现有测试通过
- `agent-loop.test.ts` 通过
- `tool-execution.test.ts` 通过

## 7. Boundaries（边界）

### 7.1 明确支持（本次迭代）

- [x] 三级结果提取策略（lastText / allAssistantText / smart）
- [x] 子代理工具列表过滤（`allowedToolNames`）
- [x] 子代理系统提示词可选覆盖
- [x] 子代理执行过程可观察（通过 `onUpdate` 回调转发 assistant 消息）

### 7.2 明确不支持（本次迭代范围外）

- [ ] 异步后台执行
- [ ] Agent 定义目录（内置子代理类型）
- [ ] Worktree / remote 隔离
- [ ] 完整的任务生命周期管理（register/kill/fail/complete）
- [ ] Sidechain transcript 持久化
- [ ] 子代理 MCP 服务器独立初始化
- [ ] 子代理权限模式覆盖（permissionMode）
- [ ] 逐消息 yield 的 AsyncGenerator 接口（本次仅通过 onUpdate 回调）

### 7.3 决策记录（ADR）

**ADR-1：为什么结果提取不采用 CC 的 finalizeAgentTool 完整遍历？**

CC 的 `finalizeAgentTool` 遍历所有消息并统计 token、工具使用次数、持续时间。YS 当前：
1. 不需要 token 统计（无计费需求）
2. 不需要工具使用计数（无 analytics）
3. 核心痛点是"最后一条 assistant 可能无实质内容"

因此采用更轻量的三级提取策略，聚焦解决核心痛点。

**ADR-2：为什么工具过滤通过 `allowedToolNames` 而非 `AgentDefinition`？**

CC 通过 `AgentDefinition`（含 `tools`、`disallowedTools`、`permissionMode` 等）精细控制。YS 当前：
1. 无 Agent 定义目录基础设施
2. `allowedToolNames` 是最小可行接口，满足"子代理不应继承全部工具"的核心需求
3. 未来如需 `AgentDefinition`，可在 `allowedToolNames` 之上封装

**ADR-3：为什么可观察性通过 `onUpdate` 回调而非 AsyncGenerator？**

CC 的 `runAgent()` 返回 `AsyncGenerator<Message>`，由调用方消费。YS 当前：
1. `Agent.prompt()` 内部直接调用 `runAgentLoop()`，无 generator 暴露
2. 改为 generator 需要重构 `Agent` 类的核心执行路径，影响面大
3. `Agent.subscribe()` 已存在，通过事件订阅 + `onUpdate` 转发成本最低
