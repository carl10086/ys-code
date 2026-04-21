# StatusBar 实时显示 Context 使用率

## 背景

当前 ys-code 的 StatusBar 仅显示状态和模型名称，无法直观看到当前 session 的 context 使用情况。参考 cc 的实现，为 StatusBar 增加 context 使用率、token 总量和费用的实时显示。

## 目标

在 StatusBar 组件上实时显示：
- **Context 使用百分比** - `(totalTokens / contextWindow) * 100`
- **Token 总量** - 累计 input + output tokens
- **Context Window 大小** - 当前模型的 context window
- **累计费用** - 当前 session 的美元成本

## 实现方案

### 数据来源

复用 `AgentSession` 的 `turn_end` 事件中已有的 `tokens` 和 `cost` 数据：

```typescript
// AgentEvent.turn_end 携带的数据
{
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
    totalTokens: number
  }
  cost: number  // 美元
}
```

### 数据流

```
API 响应
    ↓
AgentSession 处理 usage，发出 turn_end 事件
    ↓
StatusBar 订阅 turn_end 事件，收到后更新内部 state
    ↓
渲染显示
```

### StatusBar 改造

**Props 新增：**
```typescript
interface StatusBarProps {
  status: string
  modelName: string
  // 新增
  totalTokens?: number
  contextWindow?: number
  cost?: number
}
```

**显示格式：**
```
[Status] [Model] [Context: 45K/200K ████░░░░░░ 22%] [Cost: $0.32]
```

进度条使用 Unicode 方块字符 `█` 和 `░`，百分比保留整数。

**状态管理：**
- StatusBar 内部维护 `tokens`, `contextWindow`, `cost` state
- 通过 `useEffect` 订阅 AgentSession 的 `turn_end` 事件
- 每次收到事件，更新 state 并触发重渲染

### 依赖变更

无新增依赖。复用的现有类型：
- `Usage` from `src/core/ai/types.ts`
- `Model` from `src/core/ai/models.ts`

## 改动范围

- `src/tui/components/StatusBar.tsx` - 新增 props 和状态订阅逻辑
- `src/tui/hooks/useAgent.ts` - 如需更新，透传 props 给 StatusBar

## 验收标准

1. StatusBar 正确显示 Context 使用百分比和进度条
2. Token 总数和费用正确累计
3. 无 API 调用时不显示 context 信息（空值友好）
4. 进度条直观反映 context 使用比例

## 后续扩展

- 可后续引入 `/context` 命令显示详细分析
- 可后续引入本地 token 估算作为补充数据源
