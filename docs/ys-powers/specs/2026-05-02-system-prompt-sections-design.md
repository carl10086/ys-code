# Spec: System Prompt Section 结构化展示

## 1. Objective

美化 Debug Inspector 的 **System Prompt** tab，将原本纯文本平铺的 system prompt 转换为结构化展示，使开发者能够：

- 一眼看清 system prompt 由哪些 **section** 组成
- 区分每个 section 是 **static**（缓存复用）还是 **dynamic**（每轮重算）
- 快速理解每个 section 的 **作用**
- 按需展开/折叠查看具体 **内容**
- 直观识别 static 与 dynamic 之间的 **boundary**

**目标用户**：调试 agent 行为的开发者，需要理解当前 system prompt 的构成和变化。

---

## 2. Commands

不涉及新的 CLI 命令或用户交互命令。变更仅影响 Debug Inspector Web UI 的 `/debug` 页面中的 System Prompt tab。

---

## 3. Project Structure

变更涉及以下文件：

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/agent/system-prompt/coding-agent.ts` | 修改 | `export const sections`，暴露 section 定义供 debug API 使用 |
| `src/web/debug/debug-api.ts` | 修改 | 新增 `SystemPromptSectionInfo` 类型、`SECTION_DESCRIPTIONS` 常量、`buildSystemPromptSections()` 函数；`DebugContextResponse` 新增 `systemPromptSections` 字段 |
| `src/web/debug/debug.html.ts` | 修改 | 新增 section 卡片 CSS；修改 System Prompt tab 渲染逻辑，从纯文本改为结构化卡片列表 |

---

## 4. Code Style

- **TypeScript**：严格类型，使用 `interface` 定义数据结构
- **命名**：类型名使用 PascalCase，常量使用 UPPER_SNAKE_CASE，字段名使用 camelCase
- **不改核心逻辑**：`coding-agent.ts` 仅增加 `export`，不改动 `sections` 数组的任何内容或顺序
- **前端 CSS**：使用现有的 CSS 变量（`var(--pico-*)`），保持与 Pico CSS 主题一致
- **写死描述**：`SECTION_DESCRIPTIONS` 使用中文，key 为 section 的 `name` 字段

---

## 5. Testing Strategy

### 5.1 API 层测试

- `buildDebugContext()` 返回的 `systemPromptSections` 数组长度应与 `sections` 数组一致
- 每个 section 应包含正确的 `name`、`type`（根据 `getCacheKey` 是否存在判断）、`description`、`content`
- static sections 应在 dynamic sections 之前
- `systemPrompt` 字段保持兼容，仍返回拼接后的字符串

### 5.2 前端测试

- 手动验证：打开 Debug Inspector，切换到 System Prompt tab
- 验证每个 section 都显示为可折叠卡片
- 验证 static/dynamic 标签颜色正确
- 验证 boundary divider 显示在 static 和 dynamic 之间
- 验证点击 header 可以展开/折叠内容

---

## 6. Boundaries

### 6.1 Always Do
- 在 API 出口（`debug-api.ts`）做数据转换，不修改实际发给 LLM 的 system prompt
- 保持 `DebugContextResponse.systemPrompt` 字段兼容，前端优先使用 `systemPromptSections`
- section 作用说明写死在 `SECTION_DESCRIPTIONS` 中，使用中文

### 6.2 Ask First About
- 如果 `coding-agent.ts` 中的 section 定义发生变更（增删 section、改顺序），需要同步更新 `SECTION_DESCRIPTIONS`

### 6.3 Never Do
- **绝不修改** `buildCodingAgentSystemPrompt()` 或 `createSystemPromptBuilder()` 的核心逻辑
- **绝不修改** `AgentSession.refreshSystemPrompt()` 或 `getSystemPrompt()` 的行为
- **绝不在** system prompt 字符串中注入额外的标记或注释（会影响 LLM）
- **绝不修改** `SystemPrompt` 核心类型定义
