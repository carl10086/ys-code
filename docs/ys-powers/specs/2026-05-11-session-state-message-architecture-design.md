# Session 状态与消息架构重构设计

> 合并需求：状态架构边界梳理 + 消息生命周期完整化
> 分支：`feat/session-state-message-architecture-refactor-0511`

---

## 1. Objective（目标）

### 1.1 核心问题

当前架构存在三类问题：

| 类别 | 具体问题 |
|------|----------|
| **状态边界模糊** | `AgentSession` 直接穿透修改 `Agent._state.messages`（`push(msg)` / `replaceMessages()`），"谁拥有状态"不清晰 |
| **命名语义偏差** | `AgentView` 暗示只读视图，但外部已直接修改；`MutableAgentView` 语义矛盾 |
| **消息生命周期断裂** | `attachment` 仅作为临时变量传给 LLM，未进入 `agent.state.messages`，也未持久化到 session 文件 |
| **TUI 双轨并行** | UI 的 `UIMessage[]` 与 Agent 的 `AgentMessage[]` 并行维护，通过事件流同步但无一致性保证 |
| **观测不准确** | Debug Inspector LLM View 显示的 payload 缺少 `normalizeMessages()` 转换结果 |

### 1.2 设计目标

1. **明确状态所有权**：`AgentState` 为运行时内存状态的唯一源，`AgentSession` 通过事件/方法驱动更新，不直接穿透修改
2. **统一消息生命周期**：`attachment` 通过 `message_end` 事件进入状态，被 `SessionManager` 持久化
3. **消除双轨并行**：TUI 的消息列表从 `AgentState` 派生，而非独立事件流重建
4. **准确观测**：Debug Inspector 显示经过 `normalizeMessages` + `convertToLlm` 后的真实 payload

---

## 2. Commands / API Changes（接口变更）

### 2.1 命名调整

```typescript
// Before
interface AgentView { ... }
type MutableAgentView = ...;

// After
interface AgentState { ... }
type MutableAgentState = ...;
```

影响文件：
- `src/agent/types.ts` — 接口定义
- `src/agent/agent.ts` — `createMutableAgentView()` → `createMutableAgentState()`
- `src/agent/session.ts` — `this.agent.state` 类型引用
- `src/agent/agent-loop.ts` — `AgentRuntime` 引用
- `src/agent/tool-execution.ts` — `ToolUseContext.messages` 引用

### 2.2 Session 与 Agent 的交互契约

```typescript
// Before: Session 直接穿透修改
this.agent.state.messages.push(msg);
this.agent.state.tools.push(skillTool);
this.agent.replaceMessages(postCompactMessages);

// After: Session 通过方法驱动，Agent 内部自主更新
this.agent.appendMessage(msg);        // 替代 push
this.agent.registerTool(skillTool);   // 替代 tools.push
this.agent.compactMessages(postCompactMessages);  // 替代 replaceMessages
```

`Agent` 类新增方法：
- `appendMessage(message: AgentMessage): void`
- `registerTool(tool: AgentTool): void`
- `compactMessages(messages: AgentMessage[]): void`

### 2.3 消息分层模型（不变）

```
Layer 3: API Payload（临时生成）
  normalizeMessages(agent.state.messages) → Message[]
  每次请求独立构建，不保存

Layer 2: Agent State（内存状态）
  agent.state.messages: AgentMessage[]
  包含: user, assistant, toolResult, attachment
  只有 message_end 事件能追加

Layer 1: Session Store（磁盘持久化）
  ~/.ys-code/sessions/*.jsonl
  新增: attachment Entry 类型
```

---

## 3. Project Structure（项目结构）

### 3.1 核心文件职责

| 文件 | 当前职责 | 调整后职责 |
|------|----------|------------|
| `src/agent/types.ts` | `AgentView`, `AgentRuntime`, `AgentInput` | `AgentState`, `AgentRuntime`, `AgentInput` |
| `src/agent/agent.ts` | 持有 `_state: MutableAgentView` | 持有 `_state: MutableAgentState`，封装所有 mutations |
| `src/agent/session.ts` | 直接修改 `this.agent.state` | 通过 `agent.appendMessage()` 等方法驱动 |
| `src/agent/agent-loop.ts` | `LoopState.messages` 引用传递 | 保持引用传递，但明确只读/追加语义 |
| `src/tui/hooks/useAgent.ts` | 独立事件流构建 `UIMessage[]` | 从 `session.messages` 派生，减少独立状态 |
| `src/session/compact/index.ts` | compact 后通过 `replaceMessages` 替换 | 通过 `agent.compactMessages()` 替换 |
| `src/session/entry-types.ts` | 定义 session 文件 Entry 类型 | 新增 `attachment` Entry 类型 |
| `src/web/session-api.ts` | 读取 session 文件 | 支持读取 `attachment` Entry |

### 3.2 新增/修改的文件

```
src/
  agent/
    types.ts                    # AgentView → AgentState
    agent.ts                    # 封装 mutations，新增方法
    session.ts                  # 移除直接穿透修改
    agent-loop.ts               # 保持（LoopState 已正确）
    tool-execution.ts           # 引用更新（无逻辑变更）
  session/
    entry-types.ts              # 新增 attachment Entry
    session-manager.ts          # 支持 attachment 序列化/反序列化
    compact/index.ts            # 通过 agent.compactMessages() 替换
  tui/
    hooks/
      useAgent.ts               # 从 AgentState 派生 messages
```

---

## 4. Code Style（代码风格）

### 4.1 命名规范

| 概念 | 命名 | 说明 |
|------|------|------|
| 运行时内存状态 | `AgentState` | 内存语义，运行时可变 |
| 内部可变实现 | `MutableAgentState` | 通过 getter/setter 封装 |
| 对外只读接口 | `AgentState`（直接返回） | `agent.state` 返回只读代理 |
| 运行时快照 | `AgentRuntime` | 保持不变，供 stream/tool 使用 |
| 纯配置输入 | `AgentInput` | 保持不变 |

### 4.2 不可变/可变约定

- `AgentState.messages` 对外为 `readonly AgentMessage[]`
- 内部通过 `appendMessage()` / `compactMessages()` 修改，确保所有修改经过统一入口
- `AgentRuntime.messages` 为可变数组（供 loop 内部追加使用）
- `normalizeMessages()` 必须是纯函数：不修改输入，创建新数组返回

### 4.3 事件契约

```typescript
// message_end 是唯一能修改 agent.state.messages 的事件
case "message_end":
  this._state.messages = [...this._state.messages, event.message];
  break;
```

所有消息（含 attachment）必须通过 `emit({ type: "message_end", message })` 进入状态。

---

## 5. Testing Strategy（测试策略）

### 5.1 状态一致性验证

- [ ] `Agent.appendMessage()` 后 `agent.state.messages` 长度 +1
- [ ] `Agent.compactMessages()` 后 `agent.state.messages` 与传入数组一致
- [ ] `AgentSession` 恢复消息后，通过 `agent.appendMessage()` 而非直接 `push`
- [ ] compact 后 TUI 的 `messages` 与 `agent.state.messages` 同步（无残留旧消息）

### 5.2 事件流测试

- [ ] `message_end` 事件触发后 `AgentState.messages` 更新
- [ ] `attachment` 通过 `message_end` 进入状态后，可被 `normalizeMessages()` 正确过滤
- [ ] `turn_end` 后 `findLastUsage(agent.state.messages)` 返回正确值

### 5.3 序列化/反序列化测试

- [ ] `attachment` Entry 可正确序列化为 jsonl
- [ ] `attachment` Entry 可从 jsonl 恢复为 `AgentMessage`
- [ ] 旧 session 文件（无 attachment）可正常读取，忽略未知 Entry 类型

### 5.4 Debug Inspector 准确性测试

- [ ] LLM View 显示的内容与 `normalizeMessages()` 输出一致
- [ ] 包含 `<system-reminder>` 包装的系统提示词

### 5.5 回归测试

- [ ] 现有测试全部通过
- [ ] `compact` 功能正常工作
- [ ] `steer` 功能正常工作
- [ ] Session 恢复功能正常工作

---

## 6. Boundaries（边界）

### 6.1 在本次范围内

- `AgentView` → `AgentState` 命名调整及所有引用更新
- `AgentSession` 移除对 `agent.state` 的直接穿透修改
- `Agent` 新增 `appendMessage()` / `registerTool()` / `compactMessages()`
- `attachment` Entry 类型定义和序列化/反序列化
- `normalizeMessages()` 纯函数化（不修改输入）
- Debug Inspector LLM payload 准确性
- `useAgent.ts` 减少独立状态，向 `AgentState` 对齐

### 6.2 不在本次范围内

- **Web API 存储格式不变** —— `session-api.ts` 读取逻辑不变，只新增对 `attachment` 的支持
- **TUI 渲染逻辑不重构** —— `MessageList` 组件不变，只调整 `useAgent.ts` 的消息来源
- **LLM API 调用不变** —— `streamAssistantResponse` 和 `streamSimple` 逻辑不变
- **CLI 命令不变** —— `/compact`, `/reset` 等命令行为不变
- **多会话并发** —— 不涉及 SessionManager 的并发控制优化
- **文件存储格式版本控制** —— 不引入 session 文件格式版本号

### 6.3 风险点

| 风险 | 缓解措施 |
|------|----------|
| 命名调整导致大面积文件改动 | 使用 IDE 批量重构，配合类型检查 |
| TUI 消息同步逻辑变更引入 UI 不同步 | 保留事件流作为 fallback，渐进式迁移 |
| attachment 持久化增加磁盘 I/O | jsonl append 为 O(1)，实测验证 |
| 旧 session 文件兼容性 | 反序列化时忽略未知 Entry 类型 |

---

## 7. 验收标准

- [ ] 所有 `AgentView` / `MutableAgentView` 引用更新为 `AgentState` / `MutableAgentState`
- [ ] `AgentSession` 无直接 `this.agent.state.xxx.push()` / `replaceMessages()` 调用
- [ ] `Agent` 提供 `appendMessage()` / `registerTool()` / `compactMessages()` 方法
- [ ] `SessionManager` 支持 `attachment` Entry 的序列化和反序列化
- [ ] `normalizeMessages()` 为纯函数，不修改输入数组
- [ ] Debug Inspector LLM View 与真实 API payload 一致
- [ ] 现有测试全部通过
- [ ] 新增状态一致性测试、事件流测试、序列化测试

---

*文档版本: v1.0*
*创建日期: 2026-05-11*
*对应分支: feat/session-state-message-architecture-refactor-0511*
