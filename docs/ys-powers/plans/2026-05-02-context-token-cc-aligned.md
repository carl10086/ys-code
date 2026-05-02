# Context Token 对齐 cc 实施计划

**日期**: 2026-05-02
**关联 spec**: `docs/ys-powers/specs/2026-05-02-context-token-cc-aligned-design.md`
**关联分支**: `feat/grep-tool-alignment`（直接在当前分支实施）

---

## 1. 目标回顾

把 TUI StatusBar 的 `Context: XK/YK NN%` 进度条从"累加 totalTokens"改为对齐 cc 的"最近一次 API usage 的 input + cacheRead + cacheWrite / contextWindow"。详见 spec §1。

---

## 2. 依赖图

```
        ┌─────────────────────────────────┐
        │ Task 1: 端到端接线              │
        │   useAgent.ts                   │
        │   StatusBar.tsx                 │
        │   app.tsx                       │
        └──────────────┬──────────────────┘
                       │ checkpoint A: typecheck + smoke
                       ▼
        ┌─────────────────────────────────┐
        │ Task 2: 锁定行为                │
        │   StatusBar.test.tsx (改)       │
        │   useAgent.test.ts (新建)       │
        └──────────────┬──────────────────┘
                       │ checkpoint B: bun test 全绿
                       ▼
        ┌─────────────────────────────────┐
        │ Task 3: 端到端验收              │
        │   手工 TUI 5 场景               │
        │   spec §1.3 验收标准复核        │
        └──────────────┬──────────────────┘
                       │ checkpoint C: 5 轮 < 30%
                       ▼
                     commit
```

### 2.1 为何不按文件切片

`useAgent` 暴露 `totalTokens` → `app.tsx` 解构 → 传给 `StatusBar` 的 props，三者通过 prop 名强耦合。把 `totalTokens` 改名 `lastUsage` 必须三处同时改，单独改一个文件就会触发 TypeScript 编译错误。因此 Task 1 是最小不可分割的"垂直切片"——改完即得到一条完整可编译的端到端通路。

### 2.2 提交策略

- Phase 1 + Phase 2 完成后合并为**一个** commit（实现与测试在一起）
- commit message 主题：`fix(tui): align StatusBar context token with cc StatusLine`
- Phase 3 是验收阶段，不产生 commit

---

## 3. Task 详细

### 3.1 Task 1：端到端接线（实现核心）

**目的**：打通 `lastUsage` 数据流，删掉 `totalTokens` 累加逻辑，使 TUI 可编译可启动。

#### 改动文件 1：`src/tui/hooks/useAgent.ts`

具体步骤：

| 步骤 | 行号区间 | 操作 |
|---|---|---|
| ① 导入类型 | 文件顶部 | 加 `import type { Usage } from "../../core/ai/index.js";`；从 agent types 导入 `AssistantMessage` 类型（核对实际路径） |
| ② 替换 state 声明 | useAgent.ts:48 附近 | 删除 `const [totalTokens, setTotalTokens] = useState(0);`；新增 `const [lastUsage, setLastUsage] = useState<Usage \| null>(() => { const last = sessionRef.current.messages.findLast(m => m.role === "assistant"); return last ? (last as AssistantMessage).usage : null; });` |
| ③ 改 turn_end case | useAgent.ts:95-104 | 删除 `setTotalTokens((prev) => prev + event.tokens);`；新增 `const last = sessionRef.current.messages.findLast(m => m.role === "assistant"); if (last) setLastUsage((last as AssistantMessage).usage);`；保留 `setCost((prev) => prev + event.cost);` |
| ④ 改 resetSession | useAgent.ts:120-134 | 删除 `setTotalTokens(0);`；新增 `setLastUsage(null);` |
| ⑤ 改返回值 type 与对象 | useAgent.ts:30 与 150 | UseAgentResult 移除 `totalTokens: number;`，新增 `lastUsage: Usage \| null;`；返回对象同步 |
| ⑥ 加单行注释 | turn_end case 内 setLastUsage 上一行 | `// 对齐 cc utils/tokens.ts:getCurrentUsage —— 最近一次 API usage，不累加` |

#### 改动文件 2：`src/tui/components/StatusBar.tsx`

| 步骤 | 行号区间 | 操作 |
|---|---|---|
| ① props 改名 | StatusBar.tsx:14-15 | 删除 `totalTokens?: number;`；新增 `lastUsage?: Usage \| null;`；导入 `Usage` 类型 |
| ② 函数签名解构 | StatusBar.tsx:55 | 把 `totalTokens` 改成 `lastUsage` |
| ③ 替换计算 | StatusBar.tsx:66-68 | 删除 `const percentage = totalTokens && contextWindow ? Math.round(...) : null;`；改为：`const tokensInContext = lastUsage ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite : 0; const percentage = lastUsage && contextWindow ? Math.min(100, Math.round((tokensInContext / contextWindow) * 100)) : null;` |
| ④ 替换显示 | StatusBar.tsx:90-94 | 把 `formatTokens(totalTokens!)` 改成 `formatTokens(tokensInContext)`，其余格式保持 |

#### 改动文件 3：`src/tui/app.tsx`

| 步骤 | 行号 | 操作 |
|---|---|---|
| ① 解构 useAgent | app.tsx:39 | 把 `totalTokens` 改为 `lastUsage` |
| ② 传递 prop | app.tsx:120 | 把 `totalTokens={totalTokens}` 改为 `lastUsage={lastUsage}` |

#### 验收标准（Task 1）

- ✅ `tsc --noEmit` 在所有改动文件无 error（不引入新的类型错误，已有的旁路 diagnostic 不算回归）
- ✅ `grep -rn "totalTokens" src/tui` 仅剩 web/无关位置（StatusBar / useAgent / app.tsx 中无 totalTokens 引用）
- ✅ 启动 `bun src/main.ts` 不崩溃，StatusBar 能正常渲染（不发送任何消息时无 `[Context:` 段）

#### 验证命令（Task 1）

```bash
# 类型检查
tsc --noEmit
# 或项目实际 typecheck 命令（按 package.json scripts）

# 残留检查
grep -rn "totalTokens" src/tui

# Smoke：启动后 Ctrl+C 立即退出，看是否能渲染
bun src/main.ts
```

---

### Checkpoint A（Phase 1 → 2 准入）

- ✅ `tsc --noEmit` 0 error
- ✅ Smoke 启动通过
- ❌ 任何一项失败都不进 Phase 2，回 Task 1 修

---

### 3.2 Task 2：锁定行为（测试）

**目的**：防止"累加回归"再次发生，覆盖 cc 公式核心边界。

#### 改动文件 1：`src/tui/components/StatusBar.test.tsx`

新增 `describe("context progress")` 块，5 个用例：

| 用例 | render props | 期望 lastFrame() |
|---|---|---|
| `仅 input 计算正确` | `lastUsage={{ input: 10000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10000, cost: ... }}, contextWindow={204800}` | 含 `Context:` 与 `10K/204.8K`，含 `5%` |
| `input + cacheRead + cacheWrite 都计入` | `{ input: 5000, cacheRead: 8000, cacheWrite: 2000, output: 1000, totalTokens: 16000, cost }, contextWindow=204800` | 含 `15K/204.8K`（不是 16K） |
| `output 不影响百分比（回归用例）` | `{ input: 1000, output: 100000, cacheRead: 0, cacheWrite: 0, totalTokens: 101000, cost }, contextWindow=204800` | 不含 `101K`，含 `1K`，百分比 ≤ 1% |
| `lastUsage=null 时不渲染 Context 段` | `lastUsage={null}` | 不含字符串 `[Context:` |
| `percentage 上限 clamp 到 100` | `{ input: 300000, ..., contextWindow: 204800 }` | 含 `100%`，不出现 > 100 的数 |

注：构造 Usage 对象时，cost 字段可填 `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }`。

#### 改动文件 2：`src/tui/hooks/useAgent.test.ts`（新建）

参考 `bun:test` + 现有测试风格（如 `src/agent/stream-assistant.test.ts` 或类似 hook 测试）。

测试方法：直接调用 `useAgent` 不可行（hook 必须在组件里跑），用 `react-test-renderer` 或在 ink-testing-library 下用一个最小测试组件包一层。如项目无现成 hook 测试范式，参考 `claude-code-haha` 的 hook 测试或采用 `@testing-library/react-hooks`。**先在 Task 1 完成后核对项目里已有的 hook 测试方式**，再决定库选择；如果没有现成方案，退化为通过测试组件渲染来断言。

5 个用例：

| 用例 | 操作 | 关键断言 |
|---|---|---|
| 多轮 turn_end 不累加 | 派发两次 turn_end，模拟 session.messages 末尾两条 assistant.usage 分别 input=10000、input=20000 | 调用后 `lastUsage.input === 20000`（**不是 30000**） |
| 工具循环子轮也不累加 | 一次用户输入派发 3 次 turn_end（含工具调用子轮） | `lastUsage` 等于第 3 条 assistant 的 usage |
| resume 初始化 | 构造 sessionRef 时 messages 已含 assistant.usage（input=8000） | 第一次 render 后 `lastUsage.input === 8000` |
| resetSession 清空 | 调用 resetSession | `lastUsage === null` |
| cost 仍然累加（防回归）| 派发两次 turn_end，event.cost 分别 0.01、0.02 | `cost === 0.03`（验证我们没顺手改坏 cost） |

#### 验收标准（Task 2）

- ✅ `bun test src/tui/components/StatusBar.test.tsx` 全绿（含原有 web 用例）
- ✅ `bun test src/tui/hooks/useAgent.test.ts` 全绿
- ✅ `bun test` 整体全绿（无回归）

#### 验证命令（Task 2）

```bash
bun test src/tui/components/StatusBar.test.tsx
bun test src/tui/hooks/useAgent.test.ts
bun test
```

---

### Checkpoint B（Phase 2 → 3 准入）

- ✅ `bun test` 全绿
- ✅ 新增用例数 ≥ 10（StatusBar 5 + useAgent 5）
- ❌ 失败则回 Task 2 修测试或回 Task 1 修实现

---

### 3.3 Task 3：端到端验收

**目的**：在真实 TUI 中复核 spec §1.3 的验收标准都达成。

#### 手工验证清单（5 场景）

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| 1 | 空 session | 启动 `bun src/main.ts`，不输入任何消息 | StatusBar 不出现 `[Context:` 段 |
| 2 | 第一轮普通对话 | 输入 "你好" | 显示 `[Context: ~3-8K/204.8K ... ~2-4%]`，无指数膨胀 |
| 3 | 触发工具调用 | 让 agent 跑一次 grep 工具 | 工具结束后百分比平滑增长，**无跃迁式跳变**（之前的 bug 表现是工具调用一次就+一大跳） |
| 4 | 5 轮普通对话 | 连续问 5 个普通问题 | 进度条 < 30%（spec §1.3 验收标准） |
| 5 | `/clear` 重置 | 在场景 4 之后输入 `/clear` | StatusBar 立即不显示 Context 段 |

#### Spec 验收标准复核（spec §1.3）

| 验收项 | 检查方式 |
|---|---|
| 5 轮对话后 < 30% | 场景 4 |
| 工具调用循环不跃迁 | 场景 3 |
| `cost` 显示无回归 | 在场景 4 中观察 cost 字段是否仍累加正常（如果 UI 暴露的话）；或看 useAgent.test 用例 5 |
| `bun test` 全绿 | Checkpoint B |
| 类型检查通过 | Checkpoint A |

#### 验收标准（Task 3）

- ✅ 5 场景全部通过
- ✅ Spec §1.3 4 条验收全部 ✓
- ❌ 任何一项失败：定位回 Task 1（实现 bug）或 Task 2（测试漏盖）

---

### Checkpoint C（出口）

- ✅ Phase 3 全部通过
- ✅ commit 落到 `feat/grep-tool-alignment` 分支
- 准备进入 PR 流程（PR review 不在本 plan 范围）

---

## 4. 风险与回退

| 风险 | 概率 | 应对 |
|---|---|---|
| `findLast` API 在目标 Node 版本不可用 | 低（Node 18+ 支持） | 退化为手写倒序循环 |
| `useAgent` 没有现成 hook 测试范式，新建测试库依赖犹豫 | 中 | 优先内联测试组件 + ink-testing-library 模式；不引入新依赖 |
| TypeScript `(last as AssistantMessage).usage` 类型断言不必要 | 中 | 用 type guard `if (last && last.role === "assistant")` 让 TS narrow，避免 cast |
| 项目 typecheck 命令未知 | 低 | 优先 `tsc --noEmit`；按 package.json `scripts.typecheck` 调整 |
| Web 端无意中受影响 | 低 | spec §6.4 + 路径 grep 已确认 web 端不读 useAgent |

回退策略：本次改动局部、文件少、行数小（< 50 行净增）。如出现严重问题，直接 `git checkout -- src/tui/hooks/useAgent.ts src/tui/components/StatusBar.tsx src/tui/app.tsx src/tui/components/StatusBar.test.tsx` 即可还原（但要注意保留 useAgent.test.ts 的新建文件需要 `git rm`）。

---

## 5. 不在本 plan 范围

- Web 端 `totalTokens` 修改（spec §6.4）
- `tokenCountWithEstimation` 移植（spec §6.4）
- 并行工具 sibling 回溯（spec §6.4）
- autocompact / compact warning（独立大需求）
- PR 创建与 code review

---

## 6. 时间估算

| 阶段 | 估时 |
|---|---|
| Task 1（实现） | 30-45 分钟 |
| Task 2（测试） | 45-60 分钟（hook 测试范式确认 + 编写） |
| Task 3（验证） | 15-20 分钟 |
| 总计 | ~1.5-2 小时 |
