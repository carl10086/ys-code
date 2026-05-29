# max_tokens 恢复机制对齐设计

## Objective

对齐 Claude Code 的 `max_output_tokens` 恢复机制，使 ys-code 在生成长文本（>32k tokens）时能够自动恢复，而非直接失败终止。

### 背景

当前 ys-code 的 agent loop 在 LLM 输出达到 `max_tokens` 上限时，`anthropic.ts` 将 `stop_reason="max_tokens"` 映射为 `"length"`，然后抛出 `"An unknown error occurred"` 异常，最终 `stopReason` 被标记为 `"error"`，agent loop 直接终止。用户看到的是半截输出和错误提示，无法自动续写。

Claude Code 对此有两级恢复策略：
1. **Escalate**：同请求将 `max_tokens` 从默认值提升到 64k 重发
2. **Recovery**：注入 meta message 让模型从中断处继续，最多 3 次

### 成功标准

- [ ] `stopReason === "length"` 时 agent loop 不终止，进入恢复流程
- [ ] 首次 hit limit 时自动 escalate 到 64k
- [ ] Escalate 失败后自动注入 recovery message 续写，最多 3 次
- [ ] Recovery 耗尽后优雅终止，用户看到清晰错误提示
- [ ] 所有现有测试通过，新增测试覆盖恢复路径

---

## Commands

无需新增 CLI 命令或用户交互。本功能为 agent loop 内部基础设施，用户无感知。

---

## Project Structure

### 修改文件

| 文件 | 变更内容 |
|---|---|
| `src/core/ai/types.ts` | `StopReason` 新增 `"length"` |
| `src/core/ai/providers/anthropic.ts` | `mapStopReason` 保留 `"length"` 不抛异常；异常处理逻辑排除 `"length"` |
| `src/agent/agent-loop.ts` | `LoopState` 扩展；`runLoop` 插入恢复检测逻辑；新增常数 |
| `src/agent/stream-assistant.ts` | `streamAssistantResponse` 接收 `maxTokensOverride` 参数 |
| `src/agent/agent-loop.test.ts` | 新增 escalate / recovery / exhaust 测试用例 |

### 不修改文件

- `src/core/ai/providers/simple-options.ts`：默认值 32k 保持不变
- `src/agent/types.ts`：`AgentLoopConfig` 不暴露 `maxTokens` 配置给用户
- `src/agent/session.ts`：无变更
- `src/tui/`：UI 层无感知（`isMeta: true` 消息已隐藏）

---

## Code Style

- 保持与 `agent-loop.ts` 现有代码一致的注释密度和命名风格
- 新增常数使用 `UPPER_SNAKE_CASE`
- Recovery message 内容使用英文（与 LLM 交互语言保持一致）
- 状态更新采用不可变模式（`state = { ...state, ... }`）

---

## Testing Strategy

### 新增单元测试（`agent-loop.test.ts`）

| 测试名 | 场景 | 断言 |
|---|---|---|
| `escalate on first length stop reason` | `stopReason="length"`，`override=undefined` | 触发 escalate，`maxOutputTokensOverride=64000`，不终止 |
| `recovery after escalate still length` | `stopReason="length"`，`override=64000` | 注入 recovery message，`recoveryCount=1`，继续 |
| `multiple recovery attempts` | 连续 2 次 recovery 后成功 | `recoveryCount` 递增到 2，最终成功 |
| `recovery exhausted after 3 attempts` | 连续 3 次 recovery 后仍 length | 终止 loop，`agent_end` 事件 |
| `recovery message is meta` | Recovery message 的 `isMeta` 字段 | `isMeta === true` |
| `escalate preserves messages` | Escalate 时 messages 数组不变 | 不追加任何消息 |
| `recovery resets override` | Recovery 后 `maxOutputTokensOverride` | 重置为 `undefined` |

### 回归测试

- 现有 `agent-loop.test.ts` 全部通过
- 现有 `stream-assistant.test.ts` 全部通过

---

## Boundaries

### 必须做的事

- 保持默认 `max_tokens = 32000`（不对齐 CC 的 8k cap）
- Recovery message 必须为 `isMeta: true`
- Recovery 次数上限硬编码为 3
- Escalate 上限硬编码为 64000
- 所有参数不暴露给用户配置

### 必须先问清楚的事

- Recovery message 的英文内容是否需要调整？（当前对齐 CC 原文）
- Recovery 耗尽后的错误提示文案

### 不做的事

- 不实现 8k cap（留作后续优化）
- 不暴露 CLI flag 或环境变量
- 不修改 `AgentLoopConfig` 公共接口
- 不改变现有事件系统架构（不对齐 CC 的 generator 模式）
- 不处理 `max_output_tokens` 以外的 API 错误恢复（如 rate limit、auth 等）

---

## 实现顺序

1. **Step 1**：`anthropic.ts` 修复 `stopReason === "length"` 不抛异常
2. **Step 2**：`types.ts` 新增 `"length"` 到 `StopReason`
3. **Step 3**：`stream-assistant.ts` 支持 `maxTokensOverride`
4. **Step 4**：`agent-loop.ts` 实现 escalate + recovery 逻辑
5. **Step 5**：`agent-loop.test.ts` 新增测试
6. **Step 6**：运行全部测试，验证通过

---

## 参考

- CC 证据：`refer/claude-code-haha/src/query.ts:1188-1256`
- CC 证据：`refer/claude-code-haha/src/utils/context.ts:14-25`
- YS 证据：`src/agent/agent-loop.ts:55-145`
- YS 证据：`src/core/ai/providers/anthropic.ts:617-636`
