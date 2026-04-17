# Tools 使用

## 定义 Tool

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../../src/agent/index.js";

const myTool: AgentTool = {
  name: "tool_name",           // 唯一标识
  description: "What this tool does",
  parameters: Type.Object({    // TypeBox schema
    arg1: Type.String({ description: "Description" }),
    arg2: Type.Number(),
  }),
  label: "Display Name",       // UI 显示名称

  // 可选：参数预处理
  prepareArguments?: (args: unknown) => Static<TParameters>,

  // 必选：执行函数
  async execute(
    toolCallId: string,       // 工具调用 ID
    params: Static<TParameters>, // 验证后的参数
    signal?: AbortSignal,     // 中止信号
    onUpdate?: (partialResult: AgentToolResult) => void, // 进度回调
  ): Promise<AgentToolResult<TDetails>> {
    // 执行逻辑
    return {
      content: [{ type: "text", text: "结果" }],
      details: { /* 详细信息 */ },
    };
  },
};
```

## 完整示例

```typescript
import { Type } from "@sinclair/typebox";
import { Agent, type AgentTool } from "../../src/agent/index.js";
import { getModel } from "../../src/core/ai/index.js";

const calculatorTool: AgentTool = {
  name: "calculate",
  description: "Perform arithmetic operations",
  parameters: Type.Object({
    expression: Type.String({ description: "Math expression like '2 + 3'" }),
  }),
  label: "Calculator",

  async execute(toolCallId, params) {
    // 安全地计算表达式
    const sanitized = params.expression.replace(/[^0-9+\-*/().]/g, "");
    try {
      const result = Function(`"use strict"; return (${sanitized})`)();
      return {
        content: [{ type: "text", text: `${params.expression} = ${result}` }],
        details: { result },
      };
    } catch {
      return {
        content: [{ type: "text", text: "Invalid expression" }],
        details: {},
        isError: true,
      };
    }
  },
};

const agent = new Agent({
  initialState: {
    model: getModel("minimax-cn", "MiniMax-M2.7-highspeed"),
    tools: [calculatorTool],
    thinkingLevel: "off",
  },
  getApiKey: () => process.env.MINIMAX_API_KEY,
});

await agent.prompt("What is (15 * 3) + 22?");
```

## beforeToolCall 钩子

在工具执行前拦截：

```typescript
const agent = new Agent({
  initialState: { /* ... */ },
  beforeToolCall: async (context, signal) => {
    console.log("Tool:", context.toolCall.name);
    console.log("Args:", context.toolCall.arguments);

    // 可以阻止执行
    if (context.toolCall.name === "dangerous_operation") {
      return { block: true, reason: "Not allowed" };
    }

    // 或者返回 undefined 继续执行
    return undefined;
  },
});
```

### BeforeToolCallContext

```typescript
interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;  // 包含 tool call 的 assistant 消息
  toolCall: AgentToolCall;            // 工具调用块
  args: unknown;                       // 验证后的参数
  context: AgentContext;              // 当前 agent 上下文
}
```

## afterToolCall 钩子

在工具执行后修改结果：

```typescript
const agent = new Agent({
  initialState: { /* ... */ },
  afterToolCall: async (context, signal) => {
    console.log("Tool result:", context.result);

    // 可以修改结果
    return {
      content: [{ type: "text", text: "Modified: " + context.result.content[0].text }],
      details: context.result.details,
      isError: context.isError,
    };
  },
});
```

### AfterToolCallContext

```typescript
interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult;          // 原始执行结果
  isError: boolean;                  // 是否是错误
  context: AgentContext;
}
```

## AgentToolResult 结构

```typescript
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // 返回给模型的内容
  details: T;                               // 详细信息（用于 UI 等）
}
```

## 进度更新

对于长时间运行的工具，可以使用 onUpdate 回调：

```typescript
const longRunningTool: AgentTool = {
  name: "batch_process",
  parameters: Type.Object({ items: Type.Array(Type.String()) }),
  label: "Batch Process",

  async execute(toolCallId, params, signal, onUpdate) {
    const results = [];
    for (let i = 0; i < params.items.length; i++) {
      // 检查中止信号
      if (signal?.aborted) throw new Error("Aborted");

      // 处理单个项目
      const result = await processItem(params.items[i]);
      results.push(result);

      // 报告进度
      onUpdate?.({
        content: [{ type: "text", text: `Processed ${i + 1}/${params.items.length}` }],
        details: { current: i + 1, total: params.items.length },
      });
    }
    return {
      content: [{ type: "text", text: `Completed ${results.length} items` }],
      details: { results },
    };
  },
};
```

## 工具执行模式

### Sequential（顺序）

```typescript
const agent = new Agent({
  toolExecution: "sequential",
  // ...
});

// 工具按顺序一个一个执行
```

### Parallel（并行，默认）

```typescript
const agent = new Agent({
  toolExecution: "parallel",  // 默认
  // ...
});

// 工具同时执行，结果顺序保持一致
```
