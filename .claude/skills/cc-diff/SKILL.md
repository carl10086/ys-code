---
name: cc-diff
description: Use when 用户明确要求对齐 Claude Code（cc）与当前仓库某功能点实现，并需要基于源码做精细差异分析而非直接改代码。
---

# CC Diff

## Overview

把“我要对齐 cc 的某个功能”变成源码驱动的差异分析：输入功能点，读取 `claude-code-haha` 与 `ys-code` 双边实现，输出可执行的对齐差异清单。  
本 skill 只做分析和建议，不直接修改代码。

## When to Use

- 用户显式提出：对齐 `claude-code-haha` / `Claude Code` 实现
- 用户给出功能点：如 `agent loop`、`compact`、`edit tool`
- 需要“精确到细节”的设计与实现差异证据

**When NOT to use:**

- 纯重构、纯修 bug（未要求 cc 对齐）
- 需要直接产出 patch 并修改代码
- 纯性能 benchmark 任务

## The Process

一旦用户给出功能点，直接执行，不要再次请求“确认后开始”。

```
Scope → Read CC → Read YS → Compare → Gate Evidence → Recommend
```

### Step 1: Scope the Feature

把功能点拆成四个子域：

- 入口：命令、工具、API 或调用入口
- 核心：主流程、关键分支、数据结构
- 状态：内存状态、持久化、恢复
- 异常：错误路径、重试、回滚、降级

任一子域缺失，最终结论必须标为“局部对比”。

### Step 2: Read Both Sides

先读 cc，再读 ys，并使用同一子域映射：

- CC：优先 `refer/claude-code-haha`，先主路径，再边界路径
- YS：优先 `src/`，按 CC 子域寻找对应实现
- 不要只看一侧代码后推断另一侧

### Step 3: Compare by Layer

按顺序比较：

- `Design`：职责、边界、生命周期、策略选择
- `Implementation`：调用链、函数签名、数据结构、关键分支
- `Behavior`：成功路径、失败路径、边界条件、恢复策略

实现不同但运行语义等价时，标记为“实现差异（非行为差异）”。

### Step 4: Gate Evidence

每条关键结论必须有：

- 1 条 cc 证据：文件/符号/关键片段
- 1 条 ys 证据：文件/符号/关键片段

缺任一侧证据，不得写成确定事实；标记为“待确认”或“局部对比”。

## Output Contract

最终回复必须包含 5 个标题，顺序固定：

1. `Design Diff`
2. `Implementation Diff`
3. `Behavior Diff`
4. `Alignment Gaps`
5. `Prioritized Recommendations`

`Alignment Gaps` 使用差异矩阵：

```markdown
| Layer | CC Evidence | YS Evidence | Gap | Impact | Priority | Confidence |
|---|---|---|---|---|---|---|
| Design | ... | ... | ... | ... | P1 | High |
```

`Prioritized Recommendations` 必须按 P0 → P1 → P2 排序：

```markdown
- P0: <必须优先对齐的项>
  - Why: <不修会导致的风险>
  - Scope: <涉及模块/路径>
  - Verify: <如何验证对齐生效>
```

Recommendation rules:

- 至少 3 条建议
- 至少包含 1 条 `P0` 和 1 条 `P1`
- 每条必须包含 `Why/Scope/Verify`
- 每条必须可追溯到 `Alignment Gaps` 的证据
- 不输出自动改码或 patch

## Priority

- `P0`：不对齐会导致错误行为、稳定性风险、安全风险或关键能力缺失
- `P1`：对齐后显著提升一致性、恢复能力、可维护性或调试能力
- `P2`：增强项、体验项、可观测性或长期一致性优化

## Verification

输出前自检。不要默认把这份 checklist 作为报告章节输出；只有用户要求或存在缺失项时才说明。

- [ ] 已明确功能点
- [ ] 已覆盖入口/核心/状态/异常四个子域
- [ ] 已读取 cc 主路径和至少一个边界/异常路径
- [ ] 已读取 ys 对应主路径和至少一个边界/异常路径
- [ ] 已完成 Design/Implementation/Behavior 三层比对
- [ ] 每条关键结论有双边证据，证据不足处已标记“待确认”
- [ ] 已生成 `Alignment Gaps` 差异矩阵
- [ ] 已生成至少 3 条 `Prioritized Recommendations`，且包含 P0 与 P1
- [ ] 每条建议都有 `Why/Scope/Verify`
- [ ] 若覆盖不完整，已把结论降级为“局部对比”

## Red Flags

- 只看一侧代码就下结论
- 只比 happy path，不比错误路径
- 用“看起来像”替代证据
- 把推测写成确定事实
- 用户给了功能点后仍要求“确认后开始”
- 没有 P0/P1 推荐建议
- 建议脱离证据，变成泛泛方向口号
