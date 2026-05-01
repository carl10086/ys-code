# Web Message UI Markers 实施计划

## 依赖关系分析

```
Task 1: Debug Inspector 基础标记
    │
    ├── 独立 ──→ Task 3: Session Viewer 标记（可并行，但建议顺序执行）
    │
    ↓
Task 2: Debug Inspector Assistant 子类型
    │
    ↓
Checkpoint 1: Debug Inspector 完成
    │
    ↓
Task 3: Session Viewer 增强
    │
    ↓
Task 4: 最终验证
    │
    ↓
Checkpoint 2: 全部完成
```

**关键依赖**：
- Debug Inspector 和 Session Viewer 是两个完全独立的 HTML 模板，无共享 CSS/JS
- 但两者都遵循同一套视觉规范（spec 中的图标与颜色表），建议先做 Debug Inspector（改动量更大），再做 Session Viewer（对标调整）
- 每个任务只修改一个文件，任务间无代码耦合

## 任务分解（垂直切片）

### Task 1: Debug Inspector — 基础消息标记

**目标**：为 Debug Inspector 的 User、ToolResult 消息添加图标、时间戳和状态 badge，建立新的渲染框架。

**文件**：`src/web/debug/debug.html.ts`

**具体改动**：
1. 重构 `renderMessageList`：从单一模板字符串改为按 `msg.role` 分发到专用渲染函数
2. 新增 `renderUserMessage(msg)`：返回 👤 + "用户" badge + 时间戳 + 摘要
3. 新增 `renderToolResultMessage(msg)`：返回 🛠️ + 工具名 badge + ✅/❌ 状态 badge + 错误红色边框 + 摘要
4. 新增 CSS：`.message-role-badge`（圆角 badge）、`.message-tool-status`（状态指示）、`.message-timestamp`（时间戳）
5. 保持现有 `.message-item.user/assistant/tool` 边框颜色不变，新增标记叠加其上

**验收标准**：
- [ ] `/debug` 页面 Messages 标签加载后，User 消息头部显示 👤 用户 badge + 时间戳
- [ ] ToolResult 消息头部显示 🛠️ + 工具名 badge + ✅ 或 ❌ 状态 badge
- [ ] 错误状态的 ToolResult 左边框变为红色（`var(--pico-color-red-500)`）
- [ ] 消息点击展开/收起行为不变
- [ ] LLM View 标签页不受任何影响

**验证步骤**：
1. 启动应用，触发一次包含 user → assistant → tool 的完整对话
2. 打开 `/debug`，切换到 Messages 标签
3. 目视检查 User 和 ToolResult 消息的标记
4. 点击消息头部，确认展开后 JSON 内容正常
5. 切换到 LLM View 标签，确认样式未变

---

### Task 2: Debug Inspector — Assistant 子类型解析

**目标**：为 Assistant 消息添加内部 content 解析，区分 thinking、toolCall、text 三种子类型，各带图标和专用渲染。

**文件**：`src/web/debug/debug.html.ts`

**具体改动**：
1. 新增 `renderAssistantMessage(msg)`：返回 🤖 + "Assistant" badge + 时间戳 + 子类型列表
2. 在消息 body 中遍历 `msg.content` 数组：
   - `type === 'thinking'` → 🧠 "Thinking" 折叠块（`<details>`）+ 灰色背景
   - `type === 'toolCall'` → 🔧 "Tool: {name}" 块 + 黄色背景 + `<pre>` 参数
   - `type === 'text'` → 💬 正文文本（无需额外容器）
3. 新增 CSS：`.thinking-block`、`.tool-call-block`、`.message-subtype-icon`
4. 若 content 为空数组或非数组，回退到原始 JSON 展示

**验收标准**：
- [ ] Assistant 消息头部显示 🤖 Assistant badge + 时间戳
- [ ] 展开后，thinking 内容显示为 🧠 "Thinking" 可折叠块，默认收起
- [ ] 展开后，toolCall 显示为 🔧 "Tool: {name}" 参数块
- [ ] 展开后，text 显示为 💬 正文（无额外容器，直接渲染）
- [ ] 空 content 时回退到原始 JSON，不报错

**验证步骤**：
1. 在 `/debug` 页面查看 Assistant 消息
2. 展开一条 Assistant 消息，确认子类型顺序和内容正确
3. 点击 thinking 折叠块，确认展开/收起正常
4. 检查 toolCall 的参数 JSON 是否格式化显示

---

### Checkpoint 1

**入口条件**：Task 1 和 Task 2 完成且验证通过。

**检查项**：
- [ ] Debug Inspector 的 User / Assistant / ToolResult 三种消息均有新标记
- [ ] 无控制台报错（打开浏览器 DevTools 检查）
- [ ] 消息折叠/展开交互正常
- [ ] 与实施前的截图对比，视觉层次明显提升

**若未通过**：回退到对应任务修复，不进入 Task 3。

---

### Task 3: Session Viewer — Entry 视觉增强

**目标**：为 Session Viewer 的各 entry type 添加图标，增强 assistant 内部子类型和 toolResult 状态标记。

**文件**：`src/web/pages/sessions.html.ts`

**具体改动**：
1. 更新 `renderEntryCard` 中的 badge 文本：
   - header: "ℹ️ 系统"（原为 "系统"）
   - user: "👤 用户"（原为 "用户"）
   - assistant: "🤖 AI"（原为 "AI"）
   - toolResult: "🛠️ 工具结果"（原为 "工具结果"）
   - compact_boundary: "🗜️ Compact"（保持不变）
2. 更新 `renderEntryContent`：
   - thinking 折叠块的 `<summary>` 改为 "🧠 思考过程"
   - toolCall 块的名称行改为 "🔧 工具: {name}"
   - toolResult 错误状态：在工具名下方添加 `<span class="entry-error-badge">❌ 执行出错</span>`（红色背景圆角 badge）
   - toolResult 成功状态：添加 `<span class="entry-success-badge">✅ 完成</span>`（绿色背景圆角 badge）
3. 新增 CSS：`.entry-error-badge`、`.entry-success-badge`

**验收标准**：
- [ ] User entry 的 badge 显示 "👤 用户"
- [ ] Assistant entry 内部 thinking 显示 "🧠 思考过程"
- [ ] Assistant entry 内部 toolCall 显示 "🔧 工具: {name}"
- [ ] ToolResult entry 错误时显示红色 ❌ badge，成功时显示绿色 ✅ badge
- [ ] 现有边框颜色、布局、过滤功能不被破坏

**验证步骤**：
1. 打开 `/sessions`，选择一个有完整对话的 session
2. 检查各 entry card 的 badge 图标
3. 展开 assistant entry，检查 thinking 和 toolCall 的图标
4. 检查 toolResult entry 的状态 badge 颜色
5. 使用过滤下拉框切换类型，确认过滤后标记仍正确

---

### Task 4: 最终验证与回归检查

**目标**：在两个页面间做交叉验证，确保无遗漏、无回归。

**文件**：无需修改代码，纯验证任务。

**验收标准**：
- [ ] Debug Inspector 的所有消息类型（user/assistant/toolResult）均有新标记
- [ ] Session Viewer 的所有 entry 类型（header/user/assistant/toolResult/compact_boundary）均有图标
- [ ] 两个页面的响应式布局未被破坏（窗口缩放至 1024px 以下检查）
- [ ] 暗色主题下颜色对比度可接受
- [ ] 控制台无 error/warning

**验证步骤**：
1. 在 `/debug` 和 `/sessions` 之间切换，对比相同消息的标记一致性
2. 浏览器 DevTools → Console，确认无报错
3. 浏览器 DevTools → Elements，确认新增 class 命名无冲突
4. 截图保存实施前后对比

---

### Checkpoint 2

**入口条件**：Task 4 验证通过。

**检查项**：
- [ ] 所有验收标准均通过
- [ ] 代码变更仅限两个文件：`debug.html.ts` 和 `sessions.html.ts`
- [ ] 无后端 API 改动
- [ ] 无 TUI 代码改动
- [ ] git diff 清晰，变更范围符合预期

**下一步**：提交 commit，创建 PR。
