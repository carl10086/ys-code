# Tool Call 完整流程

## 概述

Tool Call 允许模型调用本地函数，实现「AI + 工具」的能力。

```
用户 → AI: "东京天气怎么样？"
AI → 用户: (tool_call: get_weather, city: "Tokyo")
用户 → AI: (tool_result: "25°C, sunny")
AI → 用户: "东京今天天气晴朗，温度25°C"
```

## 定义 Tool

```typescript
import { Type } from "@sinclair/typebox";

const getWeatherTool = {
  name: "get_weather",
  description: "获取指定城市的天气信息",
  parameters: Type.Object({
    city: Type.String({ description: "城市名称" }),
    unit: Type.Optional(Type.Union([
      Type.Literal("celsius"),
      Type.Literal("fahrenheit"),
    ])),
  }),
};

// 更多 tool...
const tools = [getWeatherTool];
```

## 发起 Tool Call 请求

```typescript
const stream = streamSimple(
  model,
  {
    systemPrompt: "你是一个有用的助手。",
    messages: [
      { role: "user", content: "东京天气怎么样？", timestamp: Date.now() },
    ],
    tools: [getWeatherTool],
  },
  { apiKey: process.env.MINIMAX_API_KEY },
);
```

## 监听 Tool Call 事件

```typescript
const toolCalls = [];

for await (const event of stream) {
  if (event.type === "toolcall_start") {
    console.log("Tool 调用开始:", event.toolCall);
  } else if (event.type === "toolcall_delta") {
    process.stdout.write(event.delta);  // 参数 JSON 片段
  } else if (event.type === "toolcall_end") {
    const toolCall = event.toolCall;
    console.log("Tool 调用完成:", toolCall);
    toolCalls.push(toolCall);
  } else if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  } else if (event.type === "done") {
    // 收集完整的 assistant message
    const assistantMessage = event.message;
    console.log("Usage:", assistantMessage.usage);
  }
}
```

## 执行 Tool 并返回结果

```typescript
async function executeToolCall(toolCall: ToolCall) {
  switch (toolCall.name) {
    case "get_weather": {
      const { city, unit } = toolCall.arguments;
      // 实际调用天气 API
      const weather = await fetchWeather(city, unit);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: JSON.stringify(weather) }],
        isError: false,
      };
    }
    default:
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: "Unknown tool" }],
        isError: true,
      };
  }
}
```

## 完整的多轮对话示例

```typescript
async function chatWithTools(userMessage: string) {
  const messages = [
    { role: "user" as const, content: userMessage, timestamp: Date.now() },
  ];

  // 第一轮：获取 tool call
  const toolCalls = [];
  const toolResults = [];

  const stream = streamSimple(model, {
    systemPrompt: "你是一个有用的助手。",
    messages,
    tools: [getWeatherTool],
  }, { apiKey });

  for await (const event of stream) {
    if (event.type === "toolcall_end") {
      toolCalls.push(event.toolCall);
    } else if (event.type === "text_delta") {
      process.stdout.write(event.delta);
    } else if (event.type === "done") {
      messages.push({
        role: "assistant",
        content: event.message.content,
        // ... 其他字段
      } as AssistantMessage);
    }
  }

  // 执行 tool calls
  for (const toolCall of toolCalls) {
    const result = await executeToolCall(toolCall);
    toolResults.push(result);
  }

  // 添加 tool results 到消息
  messages.push(...toolResults);

  // 第二轮：发送结果给模型
  const stream2 = streamSimple(model, {
    systemPrompt: "你是一个有用的助手。",
    messages,
    tools: [getWeatherTool],
  }, { apiKey });

  for await (const event of stream2) {
    if (event.type === "text_delta") {
      process.stdout.write(event.delta);
    }
  }
}
```

## toolChoice 选项

控制模型的 tool 使用行为：

```typescript
// 自动（默认）
const stream = streamSimple(model, context, {
  toolChoice: "auto",
});

// 任意 tool
const stream = streamSimple(model, context, {
  toolChoice: "any",
});

// 禁用 tool
const stream = streamSimple(model, context, {
  toolChoice: "none",
});

// 指定特定 tool
const stream = streamSimple(model, context, {
  toolChoice: { type: "tool", name: "get_weather" },
});
```

## ToolResultMessage 结构

```typescript
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;       // 对应 toolCall.id
  toolName: string;          // 工具名称
  content: (TextContent | ImageContent)[];
  details?: any;             // 可选的详细信息
  isError: boolean;          // 是否是错误结果
  timestamp: number;
}
```

## 注意事项

1. **toolCall.id 由模型生成**：Anthropic 要求格式为 `toolu_xxx`，代码会自动标准化
2. **toolResult 需要匹配 id**：否则模型无法关联结果
3. **thinking 块可能出现在 tool call 前**：如果启用了 reasoning，thinking 事件会先于 tool call 事件
4. **多个 tool call 可以并行**：可以收集多个 toolcall_end 后一起执行
