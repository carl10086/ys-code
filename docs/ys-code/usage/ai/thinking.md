# Thinking / Reasoning 配置

## reasoning 级别

```typescript
const stream = streamSimple(model, context, {
  reasoning: "medium",  // 可选值见下表
});
```

| 级别 | 说明 | 典型 thinking token |
|------|------|-------------------|
| `"minimal"` | 最少 reasoning | ~500 |
| `"low"` | 低 reasoning | ~1000 |
| `"medium"` | 中等 reasoning | ~2000 |
| `"high"` | 高 reasoning | ~4000 |
| `"xhigh"` | 极高 reasoning | ~8000+ |

## 级别 vs thinking 效果

```
用户: 解释量子纠缠

minimal: "两个粒子相关的现象"
              ↓
medium:  "两个粒子无论相距多远..." 
         "当测量一个粒子的自旋..."
         "另一个粒子的状态会即时确定"
              ↓
xhigh:   "考虑量子力学的非定域性..."
         "1935年EPR佯谬..."
         "贝尔不等式实验..."
         "最近的实验验证了..."
         (更多细节和推导)
```

## 自定义 thinking 预算

使用 `thinkingBudgets` 精确控制：

```typescript
const stream = streamSimple(model, context, {
  reasoning: "medium",
  thinkingBudgets: {
    minimal: 500,
    low: 1000,
    medium: 2000,
    high: 4000,
    xhigh: 8000,
  },
});
```

## 禁用 thinking

```typescript
// 方式1：不传 reasoning
const stream = streamSimple(model, context, {
  // reasoning: undefined（默认）
});

// 方式2：显式禁用
// 本模块不支持显式禁用 thinking，见下方说明
```

## thinking 事件流

启用 reasoning 后，可以监听 thinking 事件：

```typescript
for await (const event of stream) {
  if (event.type === "thinking_start") {
    console.log("=== Thinking 开始 ===");
  } else if (event.type === "thinking_delta") {
    process.stdout.write(event.delta);
  } else if (event.type === "thinking_end") {
    console.log("\n=== Thinking 结束 ===");
  } else if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

输出示例：

```
=== Thinking 开始 ===
我需要计算 15 * 23 + 47
先算 15 * 23 = 345
然后 345 + 47 = 392
=== Thinking 结束 ===
答案是 392
```

## thinking 和 text 交错

SDK 按事件到达顺序推送，thinking 和 text 可能交错：

```
[thinking_delta: 我需要...]
[thinking_delta: 先算 15 * 23]
[text_delta:  15]
[thinking_delta: = 345]
[text_delta:  * 23]
[thinking_delta: 然后 + 47]
[text_delta:  = 345 + 47]
[text_delta:  392]
```

## ThinkingBudgets 类型

```typescript
interface ThinkingBudgets {
  minimal?: number;  // 可选，自定义各级别预算
  low?: number;
  medium?: number;
  high?: number;
  // xhigh 使用默认值
}
```

## 注意事项

1. **thinking token 也收费**：thinking 消耗的 token 按 output 价格计费
2. **不是所有模型都支持 adaptive thinking**：`supportsAdaptiveThinking()` 判断，Claude 4.6 系列支持
3. **thinking 内容不会出现在最终 assistant.content 中**：只用于流式输出显示
