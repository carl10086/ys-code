# 流式输出详解

## 基本模式

```typescript
const stream = streamSimple(model, context, options);

for await (const event of stream) {
  switch (event.type) {
    case "start":
      // 开始
      console.log("开始生成...");
      break;

    case "text_delta":
      // 文本片段
      process.stdout.write(event.delta);
      break;

    case "text_end":
      // 文本块结束
      break;

    case "thinking_delta":
      // Thinking 片段（如果启用）
      process.stdout.write(`[thinking: ${event.delta}]`);
      break;

    case "toolcall_delta":
      // Tool 参数片段
      process.stdout.write(event.delta);
      break;

    case "toolcall_end":
      // Tool 调用完成
      console.log("Tool call:", event.toolCall);
      break;

    case "done":
      // 完成
      console.log("\n生成完成");
      console.log("Stop reason:", event.reason);
      console.log("Usage:", event.message.usage);
      break;

    case "error":
      // 错误
      console.error("Error:", event.error.errorMessage);
      break;
  }
}
```

## 等待完整结果

如果不需要流式处理，直接等结果：

```typescript
const result = await completeSimple(model, context);

console.log(result.content);      // 完整文本
console.log(result.usage);        // Token 用量
console.log(result.stopReason);  // 结束原因
```

## 取消请求

使用 `AbortSignal`：

```typescript
const controller = new AbortController();

const stream = streamSimple(model, context, {
  signal: controller.signal,
});

// 5秒后取消
setTimeout(() => controller.abort(), 5000);

for await (const event of stream) {
  // ...
}
```

## contentIndex 机制

同一个 `AssistantMessage` 可以有多个 content block：

```typescript
// 例如：同时输出文本和 tool call
AssistantMessage.content = [
  { type: "text", text: "Let me check..." },
  { type: "toolCall", id: "toolu_123", name: "get_weather", arguments: { city: "Tokyo" } }
];
```

事件通过 `contentIndex` 标识属于哪个 block：

```typescript
if (event.type === "text_delta") {
  console.log(`文本块 ${event.contentIndex}: ${event.delta}`);
} else if (event.type === "toolcall_delta") {
  console.log(`Tool块 ${event.contentIndex}: ${event.delta}`);
}
```

## 事件顺序

典型的事件序列：

```
1. start              - 开始，partial 包含空 AssistantMessage
2. content_block_start - content[0] 开始（text 或 thinking 或 toolCall）
3. content_block_delta - content[0] 片段...
4. content_block_delta - content[0] 片段...
5. content_block_stop  - content[0] 结束
6. content_block_start - content[1] 开始（下一个 block）
7. content_block_delta - content[1] 片段...
8. content_block_stop  - content[1] 结束
...（更多 blocks）
n. message_delta       - 最终更新（usage, stopReason）
n+1. done              - 完成
```

## 中间件/拦截器

使用 `onPayload` 拦截和修改请求参数：

```typescript
const stream = streamSimple(model, context, {
  onPayload: (payload, model) => {
    console.log("原始参数:", JSON.stringify(payload, null, 2));

    // 修改参数
    payload.max_tokens = 1000;

    // 返回修改后的参数（返回 undefined 则不修改）
    return payload;
  }
});
```
