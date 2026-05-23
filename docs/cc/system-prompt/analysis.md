# System Prompt 架构分析

## 1. 背景与定位

Claude Code 的 System Prompt 不是传统意义上的单一字符串，而是一个经过工程化设计的 `string[]` 数组。每个数组元素称为一个 **section**，通过 `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 将数组切分为「静态可缓存部分」与「动态实时部分」。这种设计服务于两个核心目标：

1. **Prompt Cache 优化**：静态部分附加 `cache_control: ephemeral`，跨 turn 零成本复用
2. **模块化组装**：每个 section 独立生成，支持 feature flag、不同模式的条件注入与移除

> **ys-code 现状:** 已复刻 `buildSystemPrompt() -> SystemPrompt`（brand type），结构对齐；静态/动态分割策略一致。

---

## 2. 核心原理

### 数组分层结构

```
┌─────────────────────────────────────────────────────────────┐
│  静态部分（Static Sections）—— 全局缓存                        │
│  ├── Layer 0: intro                                          │
│  ├── Layer 1: system                                         │
│  ├── Layer 2: doing_tasks                                    │
│  ├── Layer 3: actions                                        │
│  ├── Layer 4: using_your_tools                               │
│  ├── Layer 5: tone_and_style                                 │
│  └── Layer 6: output_efficiency                              │
├─────────────────────────────────────────────────────────────┤
│  边界标记: __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__                │
├─────────────────────────────────────────────────────────────┤
│  动态部分（Dynamic Sections）—— 每轮重算                       │
│  ├── Layer 8: session_specific_guidance                      │
│  ├── Layer 9: memory                                         │
│  ├── Layer 10: env_info                                      │
│  └── Layer 11: summarize_tool_results                        │
└─────────────────────────────────────────────────────────────┘
```

### 缓存键生成逻辑

Anthropic API 的 Prompt Cache 机制根据以下内容生成缓存键：

```
Cache Key = (system prompt) + (tools) + (model) + (messages prefix) + (thinking config)
```

静态部分位于 `DYNAMIC_BOUNDARY` 之前，首次请求时消耗 cache write tokens，后续 turn 作为缓存前缀复用。动态部分每轮作为新内容发送，虽然产生额外 input tokens，但换取上下文实时性。

---

## 3. 源码实现

### 核心文件

| 文件 | 职责 |
|------|------|
| `src/constants/prompts.ts:444-577` | 主构建函数 `getSystemPrompt()`，组装 12 个 section |
| `src/constants/systemPromptSections.ts:20-68` | Section 缓存框架，区分 cached vs uncached section |
| `src/constants/prompts.ts:606-756` | 环境信息计算 `computeSimpleEnvInfo()` |
| `src/memdir/memdir.ts` | Memory 系统加载 `loadMemoryPrompt()` |

### Section 生成函数

```typescript
// 静态 sections（全局缓存）
getSimpleIntroSection(outputStyleConfig)        // Layer 0
getSimpleSystemSection()                        // Layer 1
getSimpleDoingTasksSection()                    // Layer 2
getActionsSection()                             // Layer 3
getUsingYourToolsSection(enabledTools)          // Layer 4
getSimpleToneAndStyleSection()                  // Layer 5
getOutputEfficiencySection()                    // Layer 6

// 动态 sections（每轮重算）
getSessionSpecificGuidanceSection(enabledTools, skillToolCommands)  // Layer 8
loadMemoryPrompt()                                // Layer 9
computeSimpleEnvInfo(model, additionalWorkingDirectories)           // Layer 10
SUMMARIZE_TOOL_RESULTS_SECTION                    // Layer 11
```

### 关键设计：动态 Section 的条件生成

`session_specific_guidance` 的每一行都是条件生成的。如果没有任何条件命中，整个 section 返回 `null`（被过滤掉）。条件包括：

- `hasAskUserQuestionTool`
- `getIsNonInteractiveSession()`
- `hasAgentTool`
- `areExplorePlanAgentsEnabled()`
- `hasSkills`
- feature flag `VERIFICATION_AGENT`

---

## 4. 与 ys-code 对比

| cc 模块/功能 | ys-code 当前实现 | 状态 | 差异说明 |
|-------------|-----------------|------|---------|
| `getSystemPrompt() -> string[]` | `buildSystemPrompt() -> SystemPrompt` | 已对齐 | 结构对齐，返回类型加了 brand |
| `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | 同名常量 | 已对齐 | 值完全一致 |
| `systemPromptSections.ts` 缓存框架 | 无 | 已简化 | 直接 `await Promise.all` 计算动态 sections，无 section 级缓存 |
| `getSimpleIntroSection()` | `getSimpleIntroSection()` | 已对齐 | 文本基本一致，无 `outputStyleConfig` 分支 |
| `getSimpleSystemSection()` | `getSimpleSystemSection()` | 已对齐 | 文本对齐 |
| `getSimpleDoingTasksSection()` | `getSimpleDoingTasksSection()` | 已对齐 | 文本对齐，不含 ant-only 子项 |
| `getActionsSection()` | `getActionsSection()` | 已对齐 | 文本对齐 |
| `getUsingYourToolsSection()` | `getUsingYourToolsSection()` | 已对齐 | 文本对齐，简化版（无 tool 名称变量替换） |
| `getSimpleToneAndStyleSection()` | `getSimpleToneAndStyleSection()` | 已对齐 | 文本对齐 |
| `getOutputEfficiencySection()` | `getOutputEfficiencySection()` | 已对齐 | 使用外部构建版本（精简版） |
| `computeSimpleEnvInfo()` | `getEnvironmentSection()` | 已对齐 | 字段和格式基本一致 |
| `getSessionSpecificGuidanceSection()` | `getSessionSpecificGuidanceSection()` | 已对齐 | 简化版，无条件分支 |
| `loadMemoryPrompt()` | `loadMemoryEntries()` + `getAutoMemorySection()` | 已对齐 | 机制不同但效果等价 |
| MCP instructions | 无 | 未实现 | 当前无 MCP 系统 |
| Feature flag 动态 sections | 无 | 未实现 | 无 feature gate 系统 |
| `CLAUDE_CODE_SIMPLE` | 无 | 未实现 | 无简化模式 |
| Proactive mode | 无 | 未实现 | 无自主代理模式 |

---

## 5. 可借鉴点与建议

> **建议:** [P1] **Section 级缓存框架**
> 
> cc 的 `systemPromptSections.ts` 通过 `systemPromptSection()` 和 `DANGEROUS_uncachedSystemPromptSection()` 区分可缓存与强制重算的 section。ys-code 当前直接 `Promise.all` 全部重算，虽然简单但失去了细粒度缓存能力。建议后续引入 section 级缓存标记，避免不必要的重复计算。

> **建议:** [P2] **Feature Flag 动态注入**
> 
> cc 的 `session_specific_guidance` 通过 feature flag 条件注入额外指引（如 `VERIFICATION_AGENT`）。ys-code 当前 guidance section 是静态文本。建议预留条件注入能力，为后续功能扩展做准备。

> **建议:** [P2] **MCP Instructions 占位**
> 
> cc 在动态部分预留了 `mcp_instructions` section，当存在已连接的 MCP server 时注入相关指引。ys-code 当前无 MCP 系统，但建议在未来接入时复用相同的 section 位置，保持 system prompt 结构一致。

> **建议:** [P0] **边界标记一致性**
> 
> `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 的值和位置已与 cc 完全一致，这是 Prompt Cache 命中的关键。保持此标记不变，确保与 cc 的缓存策略兼容。

---

## 6. 参考链接

- **Section 缓存框架**：`refer/claude-code-haha/src/constants/systemPromptSections.ts:20-68`
- **主构建函数**：`refer/claude-code-haha/src/constants/prompts.ts:444-577`
- **环境信息计算**：`refer/claude-code-haha/src/constants/prompts.ts:606-756`
- **Session guidance**：`refer/claude-code-haha/src/constants/prompts.ts:352-400`
- **Memory 加载**：`refer/claude-code-haha/src/memdir/memdir.ts`
