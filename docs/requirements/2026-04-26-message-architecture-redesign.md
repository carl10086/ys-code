# 消息架构重构需求文档

> 描述 ys-code 消息生命周期、attachment 持久化、Debug Inspector 准确性的重构需求。
> 对应详细设计文档：[docs/cc/message-architecture-redesign.md](../cc/message-architecture-redesign.md)

---

## 1. 背景与问题

当前 ys-code 的消息架构存在以下核心问题：

1. **Attachment 生命周期断裂**：`transformMessages()` 生成的 attachment 仅作为临时变量传给 LLM API，从未进入 `agent.state.messages`，也未被持久化到 session 文件
2. **Session 持久化不完整**：`SessionManager` 不支持 `role: "attachment"` 的消息，遇到会抛出异常
3. **Debug Inspector LLM View 不准确**：显示的 LLM payload 缺少 `normalizeMessages()` 的转换结果，未反映真正传给 LLM 的完整内容
4. **AgentSession 自动恢复历史消息**：新会话启动时会自动加载历史 session，导致 Debug Inspector 显示旧数据而非当前进程状态

## 2. 设计目标

| 目标 | 说明 |
|------|------|
| **对齐 CC 架构** | Attachment 参与完整消息生命周期，可被持久化 |
| **纯转换函数** | `normalizeMessages` 不修改输入，只做 API 格式转换 |
| **准确观测** | Debug Inspector LLM View 显示真正传给 LLM 的完整 payload |
| **向后兼容** | 现有 session 文件可正常读取，新功能渐进式启用 |

## 3. 核心设计原则

### 3.1 消息分层模型

```
Layer 3: API Payload（临时生成，每次请求独立构建）
  - normalizeMessages(agent.state.messages) → user/assistant
  - prependUserContext() → 添加 CLAUDE.md 等动态上下文
  - 直接传给 LLM API，不保存

Layer 2: Agent State（内存状态，运行时可变）
  - agent.state.messages: AgentMessage[]
  - 包含: user, assistant, toolResult, attachment
  - 通过 message_end 事件追加新消息
  - 被 SessionManager 持久化到磁盘

Layer 1: Session Store（磁盘持久化，跨进程恢复）
  - ~/.ys-code/sessions/*.jsonl
  - Entry 类型: header, user, assistant, toolResult
  - 新增: attachment Entry 类型
  - 通过 SessionManager.restoreMessages() 加载到内存
```

### 3.2 关键规则

**Rule 1: 只有 `message_end` 事件能修改 `agent.state.messages`**
- 所有消息（含 attachment）必须通过 `emit({ type: "message_end", message })` 进入状态
- `transformMessages()` 不再直接修改任何状态

**Rule 2: `normalizeMessages()` 是纯函数**
- 输入: `AgentMessage[]`（含 attachment）
- 输出: `Message[]`（仅 user/assistant/toolResult）
- 不修改输入数组，不保存输出结果

**Rule 3: userContext 保持临时注入**
- CLAUDE.md、日期、分支等动态内容在 API 调用前注入
- 不保存到 session，每次请求重新读取
- 与 CC 设计一致

## 4. 功能需求

### 4.1 Attachment 持久化

- **REQ-1**: `SessionManager` 必须支持 `role: "attachment"` 的消息序列化为磁盘 Entry
- **REQ-2**: `SessionLoader` 必须支持从磁盘恢复 `type: "attachment"` 的 Entry 为内存消息
- **REQ-3**: `AgentSession` 处理 `message_end` 事件时，必须正确保存 attachment 消息到 session

### 4.2 transformMessages 重构

- **REQ-4**: 将 `transformMessages` 拆分为三阶段：
  1. `generateAttachments()`：生成需要添加的 attachment 列表
  2. `saveAttachments()`：通过事件机制将 attachment 写入 agent state
  3. `buildApiPayload()`：纯函数构建 LLM API payload
- **REQ-5**: attachment 生成后必须通过 `message_start` + `message_end` 事件进入状态，不能直接修改数组

### 4.3 normalizeMessages 纯函数化

- **REQ-6**: `normalizeMessages` 不得修改输入数组
- **REQ-7**: `normalizeMessages` 必须创建新数组返回转换结果

### 4.4 Debug Inspector 准确性

- **REQ-8**: Debug Inspector 的 LLM View 必须显示经过 `normalizeMessages` + `convertToLlm` 后的真实 payload
- **REQ-9**: Debug Inspector 应区分显示"原始消息"和"LLM Payload"

### 4.5 向后兼容

- **REQ-10**: 新代码读取旧 session 文件时，必须忽略不认识的 Entry 类型而非抛出异常
- **REQ-11**: 旧代码读取新 session 文件时，应具备版本控制或容错机制

## 5. 非功能需求

| 需求 | 说明 |
|------|------|
| **性能** | attachment 持久化不应显著影响响应时间（jsonl append 为 O(1)） |
| **可靠性** | 任何 attachment 生成失败不应阻塞主对话流程 |
| **可观测性** | 关键路径应有日志记录，便于排查问题 |
| **可测试性** | 每个阶段应可独立单元测试 |

## 6. 验收标准

- [ ] Session 文件包含 `type: "attachment"` 的 Entry
- [ ] Debug Inspector LLM View 显示的内容与 API 请求一致（包含 `<system-reminder>` 包装）
- [ ] Skill listing attachment 恢复后不再重复发送
- [ ] 现有测试全部通过
- [ ] 新增 attachment Entry 的序列化/反序列化测试
- [ ] 新增三阶段拆分的单元测试
- [ ] 新增 Debug Inspector LLM payload 准确性验证测试

---

*文档版本: v1.0*
*创建日期: 2026-04-26*
*对应设计文档: docs/cc/message-architecture-redesign.md*
