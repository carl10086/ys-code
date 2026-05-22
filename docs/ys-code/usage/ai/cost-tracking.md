# Token 用量与费用计算

## Usage 结构

```typescript
interface Usage {
  input: number;       // 输入 token 数
  output: number;      // 输出 token 数
  cacheRead: number;   // 缓存读取 token 数
  cacheWrite: number;  // 缓存写入 token 数
  totalTokens: number; // 总 token 数
  cost: {
    input: number;     // 输入费用（美元）
    output: number;    // 输出费用（美元）
    cacheRead: number; // 缓存读取费用
    cacheWrite: number;// 缓存写入费用
    total: number;     // 总费用
  };
}
```

## 获取 Usage

### 从 done 事件

```typescript
for await (const event of stream) {
  if (event.type === "done") {
    const { usage } = event.message;
    console.log(usage);
  }
}
```

输出示例：

```typescript
{
  input: 120,
  output: 85,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 205,
  cost: {
    input: 0.000036,
    output: 0.000102,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.000138
  }
}
```

### 从完整响应

```typescript
const result = await completeSimple(model, context);
console.log(result.usage);
```

## 模型定价

`models.generated.ts` 中定义：

```typescript
const MODELS = {
  "minimax-cn": {
    "MiniMax-M2.7-highspeed": {
      cost: {
        input: 0.6,        // $0.6 / 1M tokens
        output: 2.4,      // $2.4 / 1M tokens
        cacheRead: 0.06,  // $0.06 / 1M tokens
        cacheWrite: 0.375, // $0.375 / 1M tokens
      },
    },
  },
};
```

| 模型 | 输入 | 输出 | 缓存读 | 缓存写 |
|------|------|------|--------|--------|
| MiniMax-M2.7 | $0.3/M | $1.2/M | $0.06/M | $0.375/M |
| MiniMax-M2.7-highspeed | $0.6/M | $2.4/M | $0.06/M | $0.375/M |

## 手动计算费用

```typescript
import { calculateCost } from "../../src/core/ai/index.js";

const usage = {
  input: 1000,
  output: 500,
  cacheRead: 2000,
  cacheWrite: 100,
  totalTokens: 3600,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const cost = calculateCost(model, usage);

console.log(`总费用: $${cost.total.toFixed(6)}`);
// 总费用: $0.001125
```

## calculateCost 公式

```typescript
cost.input = (model.cost.input / 1_000_000) * usage.input;
cost.output = (model.cost.output / 1_000_000) * usage.output;
cost.cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead;
cost.cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite;
cost.total = cost.input + cost.output + cacheRead + cacheWrite;
```

## Thinking Token 费用

Thinking token 按 **output 价格**计费。

```typescript
// 有 reasoning 的请求
for await (const event of stream) {
  if (event.type === "done") {
    console.log(event.message.usage);
  }
}

// 输出示例（reasoning: "medium"）
{
  input: 120,
  output: 280,      // 包括 thinking token
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 400,
}
```

## 缓存优惠

使用 `cacheRetention: "long"` 可以使用缓存：

```typescript
const stream = streamSimple(model, context, {
  cacheRetention: "long",  // "none" | "short" | "long"
});
```

缓存命中后：
- `cacheRead` 会 > 0
- 缓存读费用是正常输入费用的 1/5~1/10

## 成本监控示例

```typescript
interface RequestCost {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  reasoning?: string;
}

function trackCost(event: AssistantMessageEvent): RequestCost | null {
  if (event.type !== "done") return null;

  return {
    model: event.message.model,
    provider: event.message.provider,
    inputTokens: event.message.usage.input,
    outputTokens: event.message.usage.output,
    totalCost: event.message.usage.cost.total,
  };
}

// 使用
for await (const event of stream) {
  const cost = trackCost(event);
  if (cost) {
    console.log(`[${cost.model}] ${cost.inputTokens} in + ${cost.outputTokens} out = $${cost.totalCost.toFixed(6)}`);
  }
}
```

## 注意事项

1. **usage 来自 API 返回**：模型实际计算的 token 数
2. **cost 是估算**：使用模型定价表计算，实际费用以账单为准
3. **thinking token 包含在 output 中**：无法单独区分
4. **缓存 token 仅在命中时出现**：`cacheRead: 0` 表示未使用缓存
