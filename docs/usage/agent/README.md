# Agent 模块快速开始

## 安装依赖

```bash
bun install
```

## 环境变量

```bash
# MiniMax 国际版
MINIMAX_API_KEY=your_key_here

# MiniMax 中国版
MINIMAX_CN_API_KEY=your_key_here
```

## 第一个 Agent 请求

```typescript
import { Type } from "@sinclair/typebox";
import { Agent, type AgentTool } from "../../src/agent/index.js";
import { getModel } from "../../src/core/ai/index.js";

// 定义一个加法工具
const addTool: AgentTool = {
  name: "add",
  description: "Add two numbers together",
  parameters: Type.Object({
    a: Type.Number({ description: "First number" }),
    b: Type.Number({ description: "Second number" }),
  }),
  label: "Add",
  async execute(toolCallId, params) {
    return {
      content: [{ type: "text", text: `${params.a} + ${params.b} = ${params.a + params.b}` }],
      details: { result: params.a + params.b },
    };
  },
};

// 创建 Agent
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful math assistant. Use the provided tools for ALL calculations.",
    model,
    tools: [addTool],
    thinkingLevel: "off",
  },
  getApiKey: () => process.env.MINIMAX_API_KEY,
});

// 订阅事件
agent.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log(`[Tool] ${event.toolName}(${JSON.stringify(event.args)})`);
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    const text = event.message.content.find((c) => c.type === "text");
    if (text && "text" in text) {
      console.log(`[Assistant] ${text.text}`);
    }
  }
});

// 发送 prompt
await agent.prompt("What is 5 + 3?");
await agent.waitForIdle();
```

运行：

```bash
bun run examples/agent-math.ts
```

输出：

```
[Tool] add({"a":5,"b":3})
[Assistant] 5 + 3 = 8
```

## 下一步

- [API 参考](./api-reference.md) - Agent 类所有方法
- [事件](./events.md) - AgentEvent 事件类型
- [Tools](./tools.md) - 定义和使用工具
- [状态管理](./state.md) - state 属性详解
- [Loop](./loop.md) - 低级 runAgentLoop 函数
