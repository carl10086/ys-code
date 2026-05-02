# Context Token 计算对齐 cc 设计文档

**日期**: 2026-05-02
**作者**: ys-code
**状态**: Draft
**关联分支**: `feat/grep-tool-alignment`（直接在当前分支实现）

---

## 1. 目标 (Objective)

修复 TUI StatusBar 中 `Context: XK/YK NN%` 进度条的计算 bug，使其显示语义对齐 `claude-code-haha`（以下简称 cc）的 StatusLine 行为。

### 1.1 当前 Bug

进度条数值随对话轮数和工具调用次数**指数级膨胀**，远高于真实 context 占用。例如 5 轮对话内可能出现 77K/204K (38%)，而实际 context 占用应仅为 ~20-30K。

### 1.2 根因（双重放大）

| 环节 | 位置 | 行为 |
|---|---|---|
| ① 每轮发送完整对话历史 | `src/agent/stream-assistant.ts:191` | `[...context.messages, ...attachments]` |
| ② messages 在 turn 间只增不减 | `src/agent/agent-loop.ts:70`、`tool-execution.ts:30` | 工具结果 push 进 `context.messages`，下一轮一起发出 |
| ③ Anthropic 返回的 `input_tokens` = 当轮请求的全部 input | `anthropic.ts:163` | 含系统提示 + 全部历史 |
| ④ `usage.totalTokens = input + output + cacheRead + cacheWrite` | `anthropic.ts:167-168 / 278-279` | 已经是当轮全量 |
| ⑤ 工具循环内层 while 每个子轮都 emit `turn_end` | `agent-loop.ts:74, 107-120` | 一次用户输入触发 N+1 个 turn_end |
| ⑥ UI 把每个 `turn_end` 累加 | `useAgent.ts:102` | `setTotalTokens(prev + event.tokens)` ← **bug** |

cc 在 `utils/tokens.ts:209-214` 对此场景明确警告：
> Always use this instead of: **Cumulative token counting (which double-counts as context grows)**

### 1.3 验收标准

- 5 轮对话后 StatusBar 进度条 < 30%（之前同等场景下 ≥ 70%）
- 工具调用循环不会让百分比跃迁性增长
- `cost` 显示无回归（仍正确累加）
- `bun test` 全绿、类型检查通过

---

## 2. 命令 (Commands)

| 命令 | 用途 |
|---|---|
| `bun test src/tui/components/StatusBar.test.tsx` | 跑 StatusBar 单测 |
| `bun test src/tui/hooks/useAgent.test.ts` | 跑 useAgent 单测（按需新建） |
| `bun test` | 跑全部测试 |
| `bun run typecheck` 或 `tsc --noEmit` | 类型检查 |
| `bun run dev` 或 `bun src/main.ts` | 手工 TUI 验证 |

---

## 3. 项目结构 (Project Structure)

### 3.1 改动文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/tui/hooks/useAgent.ts` | 修改 | 删 `totalTokens` 累加；新增 `lastUsage: Usage \| null` state |
| `src/tui/components/StatusBar.tsx` | 修改 | props `totalTokens` → `lastUsage`，公式改为 cc 公式 |
| `src/tui/app.tsx` | 修改 | useAgent 解构与 StatusBar prop 传递 |
| `src/tui/components/StatusBar.test.tsx` | 修改 | 用例改用 `lastUsage`，新增 output 不计入回归用例 |
| `src/tui/hooks/useAgent.test.ts` | 新建（如不存在） | 多轮 turn_end 不累加、resume 初始化、reset 清空 |

### 3.2 不变文件

| 文件 | 不动原因 |
|---|---|
| `src/agent/session.ts` | `turn_end` 事件契约不改 |
| `src/agent/agent-loop.ts` | turn 循环逻辑不变 |
| `src/core/ai/providers/anthropic.ts` | usage 字段定义已满足需求 |
| `src/web/session-api.ts` / `src/web/pages/sessions.html.ts` | web 端 totalTokens 是计费/统计语义，累加合理 |

### 3.3 不引入新文件

算法仅 5 行（`input + cacheRead + cacheWrite`），直接内联在 StatusBar 中，不抽 utils。

---

## 4. 代码风格 (Code Style)

### 4.1 算法实现（cc 一比一对照）

```ts
// 来源：refer/claude-code-haha/src/utils/context.ts:118-144
// cc 字段名 → ys-code 字段名
//   input_tokens                    → input
//   cache_creation_input_tokens     → cacheWrite
//   cache_read_input_tokens         → cacheRead
//   （output_tokens 不参与公式）

const tokensInContext = lastUsage
  ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite
  : 0;
const percentage = (lastUsage && contextWindow)
  ? Math.min(100, Math.round((tokensInContext / contextWindow) * 100))
  : null;
```

### 4.2 useAgent.ts 改动核心

```ts
// 删除：
const [totalTokens, setTotalTokens] = useState(0);
// turn_end case 内：setTotalTokens(prev => prev + event.tokens);

// 新增：
const [lastUsage, setLastUsage] = useState<Usage | null>(() => {
  const last = sessionRef.current.messages.findLast(m => m.role === "assistant");
  return last ? (last as AssistantMessage).usage : null;
});

// turn_end case 内（替换累加逻辑）：
const last = sessionRef.current.messages.findLast(m => m.role === "assistant");
if (last) setLastUsage((last as AssistantMessage).usage);
// cost 保持累加：setCost(prev => prev + event.cost);

// resetSession 内：
setLastUsage(null);  // 替换 setTotalTokens(0)
```

返回值：
- 移除 `totalTokens: number`
- 新增 `lastUsage: Usage | null`

### 4.3 StatusBar.tsx props 改动

```ts
// 移除
totalTokens?: number;

// 新增
lastUsage?: Usage | null;
```

显示文本格式不变：`[Context: {tokensInContext}/{contextWindow} {bar} {percentage}%]`

### 4.4 命名约定

- `lastUsage`：明确语义为"最后一次 API 响应的 usage"
- `tokensInContext`：明确语义为"当前 context 占用 tokens"，区别于"累计 tokens"

### 4.5 注释最少化

仅在 useAgent.ts 的 `setLastUsage` 处加一行简短注释指向 cc 来源（满足 CLAUDE.md/code.md "comment 仅在 why 非显然"原则）：

```ts
// 对齐 cc utils/tokens.ts:getCurrentUsage —— 用最近一次 API usage 而非累加
```

StatusBar 不加注释（公式从 cc 直接搬，命名已自解释）。

---

## 5. 测试策略 (Testing Strategy)

### 5.1 StatusBar.test.tsx 用例

| # | 用例名 | 输入 | 期望 |
|---|---|---|---|
| 1 | 仅 input | `lastUsage = { input: 10000, output: 0, cacheRead: 0, cacheWrite: 0, ... }`, contextWindow=204800 | 文本含 `10K/204.8K`，百分比≈5% |
| 2 | input + cacheRead + cacheWrite 全计入 | `{ input: 5000, cacheRead: 8000, cacheWrite: 2000, output: 1000 }` | tokensInContext=15000 |
| 3 | **output 不计入**（回归用例）| `{ input: 1000, output: 100000, cacheRead: 0, cacheWrite: 0 }` | 百分比按 1000 算，不是 101000 |
| 4 | lastUsage=null | `lastUsage: null` 或 undefined | 渲染中不出现 `[Context:` |
| 5 | percentage 上限 clamp | input 超过 contextWindow（如 input=300000, window=204800） | 显示 100%，不溢出 |

### 5.2 useAgent.test.ts 用例

| # | 用例名 | 关键断言 |
|---|---|---|
| 1 | 多轮 turn_end 不累加 | 派发两次 turn_end（assistant.usage.input 分别 10K、20K），最终 `lastUsage.input === 20000` |
| 2 | 工具循环子轮也不累加 | 一次用户输入触发 3 个 turn_end，`lastUsage` = 最后一条 assistant 的 usage |
| 3 | resume 初始化 | 构造 session 时 messages 已含 assistant.usage，hook 初始化后 `lastUsage` 立即非空且匹配 |
| 4 | resetSession 清空 | 调用后 `lastUsage === null` |
| 5 | cost 仍累加（防回归） | 两次 turn_end 后 `cost` 是 sum |

### 5.3 类型/编译验证

- `tsc --noEmit` 通过
- `grep -rn "totalTokens" src/tui` 应只剩注释或无关位置（不再有 hook/StatusBar 引用）

### 5.4 手工 TUI 验证清单

| # | 场景 | 期望 |
|---|---|---|
| 1 | 启动空 session | 进度条不显示 |
| 2 | 第一轮普通对话 | 显示 ~3-8K |
| 3 | 触发一次工具调用（grep 等） | 工具结束后百分比平滑增长，**无跃迁** |
| 4 | 5 轮普通对话 | 进度条 < 30% |
| 5 | `/clear` 重置 | 进度条立即消失 |

---

## 6. 边界 (Boundaries)

### 6.1 总是要做 (Always)

- 用 `lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite` 作为 tokensInContext
- `lastUsage` 取自 `session.messages.findLast(m => m.role === "assistant").usage`
- `cost` 仍按 `turn_end` 累加
- 进度条 percentage `Math.min(100, ...)` clamp

### 6.2 先问再做 (Ask First)

- 是否要把 cc 的 `tokenCountWithEstimation`（含 output + 估算 + sibling 回溯）也移植 → 当前决策为**否**（YAGNI），如未来需要 autocompact 再开新 spec
- 是否要修 web 端 totalTokens → 当前决策为**否**（语义不同，web 端是计费累计）
- 是否要改 `turn_end` 事件契约（payload 加 usage 字段） → 当前决策为**否**（hook 直接读 session.messages，避免改契约）

### 6.3 永不要做 (Never)

- 不要再写 `setLastUsage(prev => prev + ...)` 之类的累加形式
- 不要把 `output` 计入 context 进度条公式
- 不要为了"显示更精确"额外调用 token estimator（cc 的 estimation 是为 autocompact 阈值，不是为 StatusLine）
- 不要修改 `src/agent/session.ts` 的 `turn_end` 事件类型
- 不要删除或重命名 `Usage` 类型字段

### 6.4 cc 移植深度边界（明确不做）

| cc 功能 | 是否移植 | 理由 |
|---|---|---|
| StatusLine 进度条公式 | ✅ | 本 spec 唯一目标 |
| `getCurrentUsage` 倒推 messages 末尾 | ✅ | 本 spec 唯一目标 |
| `tokenCountWithEstimation`（含 output + estimation） | ❌ | 用于 autocompact 阈值判断，ys-code 当前无 autocompact |
| 并行工具调用 sibling 回溯（同 message.id 多记录） | ❌ | ys-code 数据流是单条 AssistantMessage 持有 usage，无 sibling 拆分 |
| autocompact / compact warning state | ❌ | 独立大需求，不在本 spec |
| `iterations` 字段处理 | ❌ | 服务端工具循环字段，ys-code 不依赖 |

---

## 7. 算法对照表（cc → ys-code）

| cc | ys-code | 备注 |
|---|---|---|
| `usage.input_tokens` | `usage.input` | 字段重命名 |
| `usage.cache_creation_input_tokens` | `usage.cacheWrite` | 字段重命名 |
| `usage.cache_read_input_tokens` | `usage.cacheRead` | 字段重命名 |
| `usage.output_tokens` | `usage.output` | 不参与 context 公式 |
| `getCurrentUsage(messages)` | `session.messages.findLast(m => m.role === "assistant").usage` | 直接 inline |
| `calculateContextPercentages(currentUsage, ctxSize)` | StatusBar 内联公式 | 5 行不抽 utils |
| `getContextWindowForModel(model)` | `session.model.contextWindow` | ys-code 已有现成字段 |

---

## 8. 实施顺序

1. 改 `src/tui/hooks/useAgent.ts`（删累加 + 加 lastUsage state + resetSession 清空）
2. 改 `src/tui/components/StatusBar.tsx`（props 改名 + 公式替换）
3. 改 `src/tui/app.tsx`（解构和 prop 传递）
4. 改 `src/tui/components/StatusBar.test.tsx`（5 个用例）
5. 新建 `src/tui/hooks/useAgent.test.ts`（5 个用例）
6. `bun test` + 类型检查
7. 手工 TUI 验证 5 个场景
8. commit（在当前分支 `feat/grep-tool-alignment` 上单独 commit，commit message 主题 `fix(tui): align StatusBar context token with cc StatusLine`）

---

## 9. 参考来源

- `refer/claude-code-haha/src/utils/tokens.ts:7-67`（getTokenUsage / getCurrentUsage / getTokenCountFromUsage）
- `refer/claude-code-haha/src/utils/context.ts:114-144`（calculateContextPercentages）
- `refer/claude-code-haha/src/components/StatusLine.tsx:45-47`（调用链）
- ys-code 当前 bug 位置：`src/tui/hooks/useAgent.ts:102`
