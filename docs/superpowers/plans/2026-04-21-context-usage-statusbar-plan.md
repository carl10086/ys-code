# StatusBar Context 使用率显示实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 StatusBar 上实时显示 Context 使用率、Token 总量和累计费用

**架构：** 利用 AgentSession 已有的 `turn_end` 事件（携带 tokens 和 cost）和 session.model.contextWindow，通过 useAgent hook 维护状态并透传给 StatusBar 组件。

**技术栈：** TypeScript, React (Ink), AgentSession

---

## 涉及的文件

- `src/tui/hooks/useAgent.ts` - 新增 context 状态维护，返回 context 数据
- `src/tui/components/StatusBar.tsx` - 新增 props，渲染 context 使用率和费用
- `src/tui/app.tsx` - 透传 context props 给 StatusBar

---

## Task 1: useAgent hook 新增 context 状态

**文件:**
- Modify: `src/tui/hooks/useAgent.ts`

- [ ] **Step 1: 添加 context 相关状态和返回类型**

在 `UseAgentResult` 接口新增：
```typescript
/** Context 使用信息 */
totalTokens: number;      // 累计 token 总数
contextWindow: number;    // 模型 context window 大小
cost: number;             // 累计费用（美元）
```

在 `useAgent` 函数内新增 state：
```typescript
const [totalTokens, setTotalTokens] = useState(0);
const [cost, setCost] = useState(0);
```

在 `subscribeToSession` 的 `turn_end` case 中，更新 state：
```typescript
case "turn_end": {
  setTotalTokens((prev) => prev + event.tokens);
  setCost((prev) => prev + event.cost);
  // ... 原有逻辑
}
```

在 `resetSession` 中重置：
```typescript
setTotalTokens(0);
setCost(0);
```

- [ ] **Step 2: 在 return 中透出 context 状态**

```typescript
return {
  session: sessionState,
  messages,
  shouldScrollToBottom,
  markScrolled,
  appendUserMessage,
  appendSystemMessage,
  resetSession,
  // 新增
  totalTokens,
  cost,
};
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/tui/hooks/useAgent.ts
git commit -m "feat(useAgent): add context state tracking (totalTokens, cost)"
```

---

## Task 2: StatusBar 组件改造

**文件:**
- Modify: `src/tui/components/StatusBar.tsx`

- [ ] **Step 1: 新增 Props 接口**

```typescript
export interface StatusBarProps {
  status: "idle" | "streaming" | "tool_executing";
  modelName: string;
  /** 累计 token 总数 */
  totalTokens?: number;
  /** 模型 context window 大小 */
  contextWindow?: number;
  /** 累计费用（美元） */
  cost?: number;
}
```

- [ ] **Step 2: 添加格式化辅助函数**

```typescript
/** 格式化 token 数量（超过 1000 显示为 K） */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(tokens);
}

/** 格式化美元金额 */
function formatCost(cost: number): string {
  return cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`;
}

/** 生成分数进度条 */
function renderProgressBar(percentage: number, width: number = 10): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
```

- [ ] **Step 3: 解构 props 并计算百分比**

```typescript
export function StatusBar({ status, modelName, totalTokens, contextWindow, cost }: StatusBarProps): React.ReactElement {
  const percentage = totalTokens && contextWindow
    ? Math.round((totalTokens / contextWindow) * 100)
    : null;
  // ...原有逻辑
}
```

- [ ] **Step 4: 添加 Context 显示区域**

在现有的 `<Box>` 中新增一段（放在右侧）：

```typescript
<Box>
  {percentage !== null && (
    <Text color="gray">
      {" "}[Context: {formatTokens(totalTokens!)}/{formatTokens(contextWindow!)} {renderProgressBar(percentage)} {percentage}%]
    </Text>
  )}
  {cost !== undefined && cost > 0 && (
    <Text color="gray"> [Cost: {formatCost(cost)}]</Text>
  )}
</Box>
```

- [ ] **Step 5: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/tui/components/StatusBar.tsx
git commit -m "feat(StatusBar): add context usage display with progress bar"
```

---

## Task 3: App 组件透传 context props

**文件:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: 从 useAgent 解构新增的 context 状态**

第 24 行：
```typescript
const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage, resetSession, totalTokens, cost } = useAgent({
  model,
  apiKey,
});
```

- [ ] **Step 2: 透传给 StatusBar**

第 108 行：
```typescript
<StatusBar
  status={status}
  modelName={session.model.name}
  totalTokens={totalTokens}
  contextWindow={session.model.contextWindow}
  cost={cost}
/>
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/tui/app.tsx
git commit -m "feat(App): wire context state to StatusBar"
```

---

## Task 4: 验证实现

- [ ] **Step 1: 本地运行验证**

Run: `npm run dev` 或对应的启动命令
Expected: StatusBar 显示 Context 信息，发送消息后 token 和 cost 正确累计

- [ ] **Step 2: 提交最终变更**

确保所有改动已提交，无未提交的更改

---

## 验收标准检查清单

- [ ] StatusBar 正确显示 Context 使用百分比和进度条
- [ ] Token 总数正确累加
- [ ] 费用正确累计
- [ ] 无 API 调用时不显示 context 信息（百分比为 null 时不渲染）
- [ ] 进度条直观反映 context 使用比例
