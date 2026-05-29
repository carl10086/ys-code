# system prompt 对齐设计

## Objective

对齐 Claude Code 的 system prompt 实现，解决 cc-diff 分析中发现的 9 个 gap，使 ys-code 的 system prompt 在内容完整性、cache 效率、context 注入方式三个维度上与 CC 保持一致。

### 背景

当前 ys-code 的 system prompt 存在以下核心问题：
1. **内容缺失**: intro 无品牌名、system 缺 hooks/ reminders、env-info 极简
2. **Cache 效率低**: 仅支持单级 cache scope，无法利用 Anthropic 的三级 cache
3. **Context 注入位置错误**: system context 作为 user message 注入，而非 system prompt 的一部分

### 成功标准

- [ ] 所有现有 section 内容对齐 CC（intro、system、doing-tasks、actions、using-your-tools、env-info、output-efficiency、tone-and-style）
- [ ] Cache scope splitting 支持三级（null / org / global）
- [ ] System context 注入位置从 user message 改为 system prompt 追加
- [ ] 所有现有测试通过，新增测试覆盖对齐路径
- [ ] 不新增 section（保持现有 12 个 section 列表）

---

## Commands

无需新增 CLI 命令。本功能为 agent loop 内部基础设施变更，用户无感知。

---

## Project Structure

### 修改文件

| 文件 | 变更内容 |
|---|---|
| `src/agent/system-prompt/sections/intro.ts` | 补充品牌名、CYBER_RISK_INSTRUCTION |
| `src/agent/system-prompt/sections/system.ts` | 补充 hooks section、system reminders |
| `src/agent/system-prompt/sections/doing-tasks.ts` | 补充详细编码指导 |
| `src/agent/system-prompt/sections/actions.ts` | 补充具体工具名引用 |
| `src/agent/system-prompt/sections/using-your-tools.ts` | 补充具体工具名和并行调用指导 |
| `src/agent/system-prompt/sections/env-info.ts` | 补充 git status、model description、knowledge cutoff、shell info |
| `src/agent/system-prompt/sections/output-efficiency.ts` | 保持简洁版（不对齐 ant 用户的详细 prose） |
| `src/agent/system-prompt/sections/tone-and-style.ts` | 保持基础版 |
| `src/agent/system-prompt/systemPrompt.ts` | 引入全局 cache 清除机制 |
| `src/agent/system-prompt/types.ts` | 补充 `SystemPromptBlock` 类型和 cache scope 定义 |
| `src/core/ai/providers/anthropic.ts` | `buildSystemBlocks` 支持三级 cache scope |
| `src/agent/stream-assistant.ts` | system context 从 `prependUserContext` 改为 `appendSystemContext` |
| `src/agent/session.ts` | `refreshSystemPrompt` 调用全局 cache 清除 |
| `src/agent/agent.ts` | `createLoopConfig` 传递 system context |

### 不修改文件

- `src/agent/system-prompt/coding-agent.ts`: section 列表不变
- `src/agent/system-prompt/sections/memory.ts`: 保持空实现（留作后续）
- `src/agent/system-prompt/sections/summarize-tool-results.ts`: 内容已对齐
- `src/agent/system-prompt/sections/session-specific-guidance.ts`: 保持空实现
- `src/agent/system-prompt/sections/todo-write-prompt.ts`: 内容已对齐
- `src/core/ai/types.ts`: `SystemPrompt` branded type 不变

---

## Code Style

- 保持与现有 `src/agent/system-prompt/` 代码一致的注释密度和命名风格
- Section 内容模板保持英文（与 LLM 交互语言一致）
- Cache scope 使用 `'global' | 'org' | null` 类型，对齐 CC
- 状态更新采用不可变模式

---

## Testing Strategy

### 新增单元测试

| 测试名 | 场景 | 断言 |
|---|---|---|
| `intro section contains brand name` | intro compute 结果 | 包含 "Claude Code" 或等价品牌描述 |
| `system section contains hooks reminder` | system compute 结果 | 包含 hooks section |
| `env-info section contains git status` | env-info compute 结果 | 包含 git repo 信息 |
| `env-info section contains model description` | env-info compute 结果 | 包含 model ID 描述 |
| `cache scope splitting produces correct blocks` | `buildSystemBlocks` 输入含 boundary | 返回 2+ 个 block，static 带 cache_control |
| `appendSystemContext adds context to system prompt` | `appendSystemContext(systemPrompt, context)` | 返回数组末尾追加 context |
| `system prompt builder cache can be cleared` | `clearSystemPromptSections()` 后重新构建 | section 重新计算 |

### 回归测试

- 现有 `systemPrompt.test.ts` 全部通过
- 现有 `agent-loop.test.ts` 全部通过
- 现有 `stream-assistant.test.ts` 全部通过

---

## Boundaries

### 必须做的事

- 保持现有 12 个 section 不变（不新增、不删除）
- section 内容使用英文
- 默认 `max_tokens = 32000` 不变
- 所有参数不暴露给用户配置

### 必须先问清楚的事

- CYBER_RISK_INSTRUCTION 的具体内容是否需要调整？
- output-efficiency section 是否保持简洁版（不对齐 ant 用户的详细 prose）？

### 不做的事

- 不新增 section（language、mcp_instructions、token_budget 等留作后续）
- 不实现 feature gate 支持
- 不修改 `AgentLoopConfig` 公共接口的字段名
- 不改变现有事件系统架构
- 不处理 memory prompt 的完整集成（section 存在但 compute 为空，留作后续）

---

## 实现顺序

1. **Step 1**: 补齐 section 内容（intro、system、doing-tasks、actions、using-your-tools、env-info）
2. **Step 2**: `systemPrompt.ts` 引入全局 cache 清除机制
3. **Step 3**: `types.ts` 补充 `SystemPromptBlock` 和 cache scope 类型
4. **Step 4**: `anthropic.ts` 实现三级 cache scope splitting
5. **Step 5**: `stream-assistant.ts` 将 system context 注入改为 appendSystemContext
6. **Step 6**: `session.ts` 和 `agent.ts` 适配新接口
7. **Step 7**: 运行全部测试，验证通过

---

## 参考

- CC 证据: `refer/claude-code-haha/src/constants/prompts.ts:175-577`
- CC 证据: `refer/claude-code-haha/src/constants/systemPromptSections.ts:10-68`
- CC 证据: `refer/claude-code-haha/src/utils/api.ts:321-435`
- CC 证据: `refer/claude-code-haha/src/services/api/claude.ts:3213-3237`
- YS 证据: `src/agent/system-prompt/sections/*.ts`
- YS 证据: `src/agent/system-prompt/systemPrompt.ts`
- YS 证据: `src/core/ai/providers/anthropic.ts:397-423`
