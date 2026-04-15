# AI 模块快速开始

## 安装依赖

```bash
bun install
```

## 环境变量

```bash
# MiniMax 国际版
MINIMAX_API_KEY=your_key_here

# MiniMax 中国版（二选一）
MINIMAX_CN_API_KEY=your_key_here
```

## 第一个请求

```typescript
import { getModel, streamSimple } from "../../src/core/ai/index.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const stream = streamSimple(
  model,
  {
    messages: [
      {
        role: "user",
        content: "Hello, who are you?",
        timestamp: Date.now(),
      },
    ],
  },
  {
    apiKey: process.env.MINIMAX_API_KEY,
  },
);

for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  } else if (event.type === "done") {
    console.log("\n---");
    console.log(`Usage: input=${event.message.usage.input}, output=${event.message.usage.output}`);
  }
}
```

运行：

```bash
bun run examples/chat-minimax.ts
```

输出：

```
Hello! I'm MiniMax-M2.7, a helpful AI assistant...

---
Usage: input=xx, output=xx
```

## 启用 Thinking

```typescript
const stream = streamSimple(model, context, {
  apiKey: process.env.MINIMAX_API_KEY,
  reasoning: "medium",  // minimal | low | medium | high | xhigh
});

for await (const event of stream) {
  if (event.type === "thinking_delta") {
    process.stdout.write(`[thinking: ${event.delta}]`);
  } else if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

## 下一步

- [API 参考](./api-reference.md) - 所有导出函数
- [流式输出](./streaming.md) - 事件流详解
- [Thinking](./thinking.md) - reasoning 深入配置
- [Tool Call](./tool-call.md) - 函数调用
- [费用追踪](./cost-tracking.md) - Token 用量
