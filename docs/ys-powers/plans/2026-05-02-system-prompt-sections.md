# Plan: System Prompt Section 结构化展示

## 依赖关系

```
coding-agent.ts (export sections)
         │
         ▼
debug-api.ts (构建 systemPromptSections)
         │
         ▼
debug.html.ts (前端结构化渲染)
```

---

## 任务 1：API 层 — 导出 sections 并构建结构化数据

### 目标
让 Debug API 能够返回结构化的 system prompt section 信息。

### 涉及文件
- `src/agent/system-prompt/coding-agent.ts`
- `src/web/debug/debug-api.ts`

### 实现步骤

1. **导出 sections**
   - `coding-agent.ts` 第 26 行：`const sections` → `export const sections`

2. **新增类型和常量（debug-api.ts）**
   - `SystemPromptSectionInfo` interface：含 `name`, `type`, `description`, `content`
   - `SECTION_DESCRIPTIONS` 常量：写死的中文作用说明，key 为 section name

3. **新增构建函数（debug-api.ts）**
   - `buildSystemPromptSections(session)`：
     - 构造 `SystemPromptContext`（`cwd`, `tools`, `model` 从 session 获取）
     - 调用 `buildCodingAgentSystemPrompt(context)` 得到 `SystemPrompt`（string[]）
     - 遍历 `sections` 数组，按索引匹配内容
     - `type` = `getCacheKey ? "static" : "dynamic"`
     - `description` = `SECTION_DESCRIPTIONS[section.name]`
     - 返回 `SystemPromptSectionInfo[]`

4. **修改 `buildDebugContext()`**
   - `DebugContextResponse` 新增 `systemPromptSections: SystemPromptSectionInfo[]`
   - 调用 `buildSystemPromptSections(session)` 填充该字段
   - `systemPrompt` 字段保持原有逻辑不变（兼容）

### 验收标准
- [ ] `coding-agent.ts` 成功 export `sections`，其他模块可 import
- [ ] `buildDebugContext()` 返回的 `systemPromptSections` 数组长度等于 `sections.length`
- [ ] 每个 section 都有正确的 `name`、`type`（static/dynamic）、`description`、`content`
- [ ] static sections 全部排在 dynamic sections 之前
- [ ] `systemPrompt` 字段仍返回字符串，不影响兼容性

### 验证方式
- 运行 `bun test src/web/debug/debug-api.test.ts`（如有现有测试）
- 或手动启动服务，访问 `/api/debug/context`，检查 JSON 中的 `systemPromptSections` 字段

---

## Checkpoint 1

API 层完成，确认：
- `/api/debug/context` 返回的 JSON 包含完整且正确的 `systemPromptSections`
- 无 TypeScript 编译错误

---

## 任务 2：前端层 — System Prompt tab 结构化渲染

### 目标
将 System Prompt tab 从纯文本 `<pre>` 改为可折叠的 section 卡片列表。

### 涉及文件
- `src/web/debug/debug.html.ts`

### 实现步骤

1. **新增 CSS**
   - `.section-card`：卡片容器，带边框、圆角、下边距
   - `.section-header`：头部，flex 布局，可点击，hover 效果
   - `.section-name`：section 名称，粗体
   - `.section-type`：类型标签，static 绿色、dynamic 橙色
   - `.section-desc`：作用说明，灰色小字，右对齐
   - `.boundary-divider`：boundary 分隔线，居中文字，虚线边框，主题色
   - `.section-content`：内容区域，默认隐藏，展开时显示
   - `.section-content pre`：代码块，max-height 400px，可滚动

2. **新增渲染函数**
   - `renderSystemPromptSections(sections)`：
     - 遍历 sections，生成卡片 HTML
     - 遇到 static→dynamic 切换时，插入 boundary divider
     - 每个卡片包含 header（name + type badge + desc）和可折叠的 content
   - `setupSectionToggle()`：事件委托，点击 header 切换 content 显示

3. **修改 `loadData()` 中的 system prompt 渲染**
   - 将原有的 `document.getElementById('tab-system').innerHTML = '<pre><code>' + ...` 
   - 改为调用 `renderSystemPromptSections(data.systemPromptSections)`
   - 若 `systemPromptSections` 不存在，fallback 到原有纯文本展示

4. **绑定交互**
   - 在 `loadData()` 后调用 `setupSectionToggle()`

### 验收标准
- [ ] System Prompt tab 显示为 section 卡片列表，而非纯文本
- [ ] 每个卡片显示 section 名称、static/dynamic 标签（颜色不同）、中文作用说明
- [ ] static sections 和 dynamic sections 之间有醒目的 boundary divider
- [ ] 点击卡片 header 可以展开/折叠内容
- [ ] 内容区域使用 `<pre><code>` 保持等宽字体，支持滚动
- [ ] 若 API 未返回 `systemPromptSections`，graceful fallback 到纯文本

### 验证方式
- 启动服务，打开 Debug Inspector（`http://127.0.0.1:<port>/debug`）
- 切换到 System Prompt tab
- 逐个验证上述验收标准
- 检查不同主题（dark/light）下样式是否正常

---

## 任务依赖

| 任务 | 依赖 | 说明 |
|---|---|---|
| 任务 1 | 无 | 可独立开发 |
| 任务 2 | 任务 1 | 需要 `systemPromptSections` 数据 |

建议按顺序执行，先完成任务 1 并验证 API 数据正确，再进入任务 2。
