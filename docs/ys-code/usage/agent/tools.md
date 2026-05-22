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
  outputSchema: Type.Object({ result: Type.String() }),
  label: "Display Name",       // UI 显示名称

  // 可选：参数预处理
  prepareArguments: (args: unknown) => args,

  // 可选：参数校验（在权限检查前调用）
  validateInput: async (params, context) => {
    return params.arg1.length > 0
      ? { ok: true }
      : { ok: false, message: "arg1 is required" };
  },

  // 可选：权限检查
  checkPermissions: async (params, context) => {
    return { allowed: true };
  },

  // 必选：执行函数
  async execute(toolCallId, params, context, onUpdate) {
    // 执行逻辑
    return { result: `Processed ${params.arg1}` };
  },

  // 可选：把业务输出转换为模型可见内容
  formatResult: (output) => [{ type: "text", text: output.result }],
} satisfies AgentTool;
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
  outputSchema: Type.Object({
    result: Type.Number(),
  }),
  label: "Calculator",

  async execute(toolCallId, params) {
    // 安全地计算表达式
    const sanitized = params.expression.replace(/[^0-9+\-*/().]/g, "");
    try {
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { result };
    } catch {
      throw new Error("Invalid expression");
    }
  },

  formatResult: (output) => [{ type: "text", text: String(output.result) }],
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

## Tool 级校验与权限

工具可以通过 `validateInput` 和 `checkPermissions` 在执行前做参数校验和权限决策：

```typescript
const dangerousTool: AgentTool = {
  name: "dangerous_operation",
  description: "Dangerous operation",
  parameters: Type.Object({ confirmed: Type.Boolean() }),
  outputSchema: Type.Object({ ok: Type.Boolean() }),
  label: "Dangerous",

  async validateInput(params) {
    if (!params.confirmed) {
      return { ok: false, message: "Operation must be explicitly confirmed" };
    }
    return { ok: true };
  },

  async checkPermissions(_params, context) {
    const allowed = context.tools.some((tool) => tool.name === "dangerous_operation");
    return allowed ? { allowed: true } : { allowed: false, reason: "Not allowed" };
  },

  async execute() {
    return { ok: true };
  },
};
```

## AgentToolResult 结构

```typescript
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // 返回给模型的内容
  details: T;                               // 详细信息（用于 UI 等）
  renderData?: ToolRenderResult;            // TUI 渲染数据（可选）
  newMessages?: AgentMessage[];             // 注入下一轮上下文的消息（可选）
  contextModifier?: (messages: AgentMessage[]) => AgentMessage[]; // 上下文修改器（可选）
  modelOverride?: string;                   // 下一轮临时模型覆盖（可选）
}
```

## 进度更新

对于长时间运行的工具，可以使用 onUpdate 回调：

```typescript
const longRunningTool: AgentTool = {
  name: "batch_process",
  parameters: Type.Object({ items: Type.Array(Type.String()) }),
  outputSchema: Type.Object({ results: Type.Array(Type.Unknown()) }),
  label: "Batch Process",

  async execute(toolCallId, params, context, onUpdate) {
    const results = [];
    for (let i = 0; i < params.items.length; i++) {
      // 检查中止信号
      if (context.abortSignal.aborted) throw new Error("Aborted");

      // 处理单个项目
      const result = await processItem(params.items[i]);
      results.push(result);

      // 报告进度
      onUpdate?.({ current: i + 1, total: params.items.length });
    }
    return { results };
  },

  formatResult: (output) => [{ type: "text", text: `Completed ${output.results.length} items` }],
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
