# Session 状态与消息架构重构 — 实现计划

> 对应 Spec: `docs/ys-powers/specs/2026-05-11-session-state-message-architecture-design.md`
> 分支: `feat/session-state-message-architecture-refactor-0511`

---

## 1. 上下文

### 1.1 问题

- `AgentView` / `MutableAgentView` 命名语义偏差：外部已直接修改，"View" 的只读契约不成立
- `AgentSession` 直接穿透修改 `Agent._state`：`messages.push()`、`tools.push()`
- `attachment` 消息未持久化：`SessionManager` 显式跳过 `role === "attachment"`
- TUI 维护独立 `UIMessage[]`，与 `AgentState.messages` 无 reconciliation

### 1.2 关键依赖

```
AgentState 命名 (Task 1)
    │
    ├── Agent 封装方法 (Task 1) ──→ Session 迁移 (Task 2)
    │                                    │
    │                                    ├── Attachment 持久化 (Task 3)
    │                                    │
    │                                    └── TUI 对齐 (Task 4)
    │
    └── normalizeMessages 纯函数验证 (Task 5)
```

---

## 2. 任务列表（垂直切片）

### Task 1: 命名重构 + Agent 封装方法

**目标**：完成 `AgentView` → `AgentState` 全局重命名，并在 `Agent` 类中新增封装方法。

**改动文件**：
- `src/agent/types.ts` — 重命名接口
- `src/agent/agent.ts` — 重命名内部类型，新增方法
- `src/agent/session.ts` — 更新引用
- `src/agent/agent-loop.ts` — 更新引用
- `src/agent/tool-execution.ts` — 更新引用（`AgentRuntime` 含 `messages`，类型名不变）

**新增方法**：
```typescript
class Agent {
  appendMessage(message: AgentMessage): void;
  registerTool(tool: AgentTool): void;
  compactMessages(messages: AgentMessage[]): void;
}
```

**验收标准**：
- [ ] 项目中无 `AgentView` / `MutableAgentView` 残留引用
- [ ] `Agent.appendMessage()` 内部使用 `[...messages, msg]` 不可变更新
- [ ] `Agent.registerTool()` 内部使用 `[...tools, tool]` 不可变更新
- [ ] `Agent.compactMessages()` 内部使用 `messages.slice()` 防御性拷贝
- [ ] `bun run build` 编译通过

**验证步骤**：
```bash
grep -r "AgentView\|MutableAgentView" src/ || echo "Clean"
bun run build
```

**预估工作量**：medium

---

### Task 2: Session 迁移到封装方法

**目标**：移除 `AgentSession` 对 `Agent._state` 的所有直接穿透修改。

**改动文件**：
- `src/agent/session.ts`

**替换点**：
| 行号 | 当前代码 | 替换为 |
|------|----------|--------|
| 155 | `this.agent.state.messages.push(msg)` | `this.agent.appendMessage(msg)` |
| 186 | `this.agent.state.tools.push(skillTool)` | `this.agent.registerTool(skillTool)` |
| 301 | `this.agent.replaceMessages(postCompactMessages)` | `this.agent.compactMessages(postCompactMessages)` |

**验收标准**：
- [ ] `session.ts` 中无直接访问 `this.agent.state.messages` / `this.agent.state.tools` 的修改操作
- [ ] Session 恢复功能正常（启动时可加载历史消息）
- [ ] SkillTool 注册正常
- [ ] Compact 后消息列表正确替换

**验证步骤**：
```bash
grep -n "state\.messages\.push\|state\.tools\.push\|replaceMessages" src/agent/session.ts || echo "Clean"
bun test src/agent/session.test.ts  # 如有
```

**预估工作量**：small

---

### Task 3: Attachment 持久化

**目标**：`SessionManager` 支持 `role: "attachment"` 消息的序列化与反序列化。

**改动文件**：
- `src/session/entry-types.ts` — 确认 `AttachmentEntry` 已定义
- `src/session/session-manager.ts` — 移除跳过逻辑，添加序列化
- `src/session/session-loader.ts` — 添加反序列化
- `src/web/session-api.ts` — 统计时包含 attachment

**关键代码**：
```typescript
// session-manager.ts 当前（需移除）
if (message.role === "attachment") return;

// 替换为：正常序列化为 { type: "attachment", ... }
```

**验收标准**：
- [ ] `SessionManager.appendMessage()` 遇到 `role: "attachment"` 正常写入 jsonl
- [ ] `SessionLoader` 可从 jsonl 恢复 `attachment` 为 `AgentMessage`
- [ ] 旧 session 文件（无 attachment entry）读取不报错，忽略未知类型
- [ ] `session-api.ts` 列表/详情统计包含 attachment

**验证步骤**：
```bash
# 手动验证：启动对话，观察 ~/.ys-code/sessions/*.jsonl 是否含 attachment 行
cat ~/.ys-code/sessions/*.jsonl | grep '"type":"attachment"'
```

**预估工作量**：medium

---

### Task 4: TUI 消息对齐

**目标**：`useAgent.ts` 的 `UIMessage[]` 从 `session.messages` 派生，而非独立事件流重建。

**改动文件**：
- `src/tui/hooks/useAgent.ts`
- `src/tui/types.ts` — 可能需要新增 UIMessage 的派生逻辑

**方案**：
保留事件流作为增量更新来源，但增加从 `session.messages` 的 reconciliation 机制：
- `turn_end` 时从 `session.messages` 重新派生完整的 `UIMessage[]`
- 或者：在 `turn_start` 时清空 UIMessage，整个 turn 的事件流重建，turn_end 时与 session.messages 校验一致性

**验收标准**：
- [ ] Compact 后 TUI 消息列表与 Agent 状态一致（无残留旧消息）
- [ ] 多轮对话后 UIMessage[] 长度与 `session.messages` 中 user/assistant/tool 数量一致
- [ ] Streaming 过程中 UI 仍实时更新（不破坏现有体验）

**验证步骤**：
```bash
# 手动测试：对话 → compact → 观察 UI 是否同步
```

**预估工作量**：medium

---

### Task 5: normalizeMessages 纯函数验证 + Debug Inspector

**目标**：确认 `normalizeMessages()` 不修改输入数组；Debug Inspector 显示真实 payload。

**改动文件**：
- `src/agent/attachments/normalize.ts` — 确认实现为纯函数
- `src/web/debug/debug-api.ts` — 验证 LLM View 逻辑

**验收标准**：
- [ ] `normalizeMessages(input)` 执行后 `input` 数组未被修改（深比较）
- [ ] `normalizeMessages()` 返回新数组
- [ ] Debug Inspector LLM View 与 `normalizeMessages() + convertToLlm()` 输出一致
- [ ] 新增 `normalizeMessages` 纯函数单元测试

**验证步骤**：
```bash
bun test src/agent/attachments/normalize.test.ts  # 如有，或新建
```

**预估工作量**：small

---

### Task 6: 回归测试

**目标**：全量测试通过，端到端验证核心流程。

**验收标准**：
- [ ] `bun test` 全量通过
- [ ] `bun run build` 无错误
- [ ] 手动端到端：启动 → 对话 → 工具调用 → compact → 恢复 → 继续对话
- [ ] 旧 session 文件可正常恢复

**验证步骤**：
```bash
bun test
bun run build
```

**预估工作量**：small

---

## 3. 检查点

| 检查点 | 前置任务 | 验证标准 |
|--------|----------|----------|
| **CP1: 命名与封装完成** | Task 1 + Task 2 | 编译通过，Session 无直接穿透，核心功能正常 |
| **CP2: 持久化完成** | CP1 + Task 3 | Attachment 可序列化/反序列化，旧文件兼容 |
| **CP3: 架构对齐完成** | CP2 + Task 4 + Task 5 | TUI 与 Agent 状态一致，normalizeMessages 纯函数 |
| **CP4: 全量回归通过** | CP3 + Task 6 | 所有测试通过，端到端验证通过 |

---

## 4. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 命名调整导致大面积引用错误 | 编译失败 | 使用 IDE 全局重构（F2），配合类型检查逐步修复 |
| TUI 消息对齐引入 UI 不同步 | 用户体验下降 | 保留事件流作为增量来源，仅 turn_end 时 reconciliation |
| Attachment 持久化增加 I/O | 响应延迟 | jsonl append 为 O(1)，实测验证无感知延迟 |
| Compact 后状态不一致 | 消息残留 | Task 4 的 reconciliation 机制确保 turn_end 时对齐 |

---

## 5. 执行顺序

```
Task 1 (命名+封装)
    │
    ▼
Task 2 (Session 迁移)
    │
    ├──→ Task 3 (Attachment 持久化)
    │
    └──→ Task 4 (TUI 对齐)
             │
             └──→ Task 5 (纯函数验证)
                      │
                      └──→ Task 6 (回归测试)
```

---

*文档版本: v1.0*
*创建日期: 2026-05-11*
*对应 Spec: docs/ys-powers/specs/2026-05-11-session-state-message-architecture-design.md*
