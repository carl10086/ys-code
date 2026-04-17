# stream-assistant.ts 完整重构设计

## 1. 目标

对 `src/agent/stream-assistant.ts` 进行完整重构：
- 修复 `context.tools as any` 类型断言问题
- 补全中文注释
- 统一注释风格

## 2. 变更范围

### 2.1 修复类型安全问题

**问题位置：** 第 56 行 `context.tools as any`

**解决方案：** 创建类型安全的工具转换函数

当前代码：
```typescript
tools: context.tools as any,
```

修改为：
```typescript
tools: (context.tools ?? []) as LlmTools,
```

其中 `LlmTools` 是从 `../core/ai/index.js` 导入的正确类型。

### 2.2 添加函数中文注释

为 `streamAssistantResponse` 函数添加中文注释：

```typescript
/**
 * 流式获取 assistant 响应
 * @param context Agent 上下文
 * @param config AgentLoop 配置
 * @param signal 可选的 abort 信号
 * @param emit 事件发射器
 * @param streamFn 可选的流函数
 * @returns AssistantMessage 最终消息
 */
export async function streamAssistantResponse(
  ...
): Promise<AssistantMessage> {
```

### 2.3 统一注释风格

为 switch case 分支添加中文注释：

| 分支 | 注释 |
|------|------|
| `case "start":` | 消息开始，创建 partial message |
| `case "text_start":` | 文本块开始 |
| `case "text_delta":` | 文本增量 |
| `case "text_end":` | 文本块结束 |
| `case "thinking_start":` | 思考开始 |
| `case "thinking_delta":` | 思考增量 |
| `case "thinking_end":` | 思考结束 |
| `case "toolcall_start":` | 工具调用开始 |
| `case "toolcall_delta":` | 工具调用增量 |
| `case "toolcall_end":` | 工具调用结束 |
| `case "done":` | 流式响应完成 |
| `case "error":` | 流式响应错误 |

## 3. 不变更项

- 不创建新文件
- 不拆分现有函数
- 不改变函数签名
- 不改变代码逻辑

## 4. 风险评估

| 风险 | 缓解措施 |
|------|---------|
| 类型转换引入错误 | 使用正确的类型导入，确保类型兼容 |
| 注释改动引入错误 | 仅文本改动，无逻辑变更 |

## 5. 验收标准

- `context.tools as any` 类型断言已消除
- 所有函数、类型都有中文注释
- switch case 分支都有中文注释
- TypeScript 编译无错误
- 现有测试全部通过
