# Web Message UI Markers 设计文档

## 1. Objective

为 ys-code 的 Web 调试界面（Debug Inspector 和 Session Viewer）的消息添加丰富的 UI 标记，提升消息类型的可辨识度，使其在视觉层次上对齐 TUI 终端界面。

**核心价值**：开发者通过 Web 页面查看会话时，能一眼识别消息类型（用户输入、AI 思考、工具调用、错误结果等），无需展开 JSON 即可理解消息结构。

## 2. Commands

无新增 CLI 命令。本次改动纯前端增强，不影响构建/运行命令。

验证方式：
```bash
# 启动应用后访问
open http://127.0.0.1:<port>/debug
open http://127.0.0.1:<port>/sessions
```

## 3. Project Structure

变更范围限定于两个前端 HTML 模板文件：

```
src/
  web/
    debug/
      debug.html.ts    # ← Debug Inspector 页面增强
    pages/
      sessions.html.ts # ← Session Viewer 页面增强
```

**不改动的文件**（边界内禁止触碰）：
- `src/web/debug/debug-api.ts` — 后端 API 数据结构
- `src/web/session-api.ts` — 后端 API 数据结构
- `src/tui/**/*` — TUI 终端界面
- `src/agent/**/*` — Agent 内核
- `src/core/**/*` — 核心层
- `src/session/**/*` — 持久化层

## 4. Code Style

### 视觉标记规范

| 消息类型 | 图标 | 标签 | 边框/背景色 | 适用页面 |
|---------|------|------|------------|---------|
| User | 👤 | 用户 | 蓝色左边框 | Debug, Session |
| Assistant (整体) | 🤖 | Assistant | 绿色左边框 | Debug |
| — Text (子类型) | 💬 | Response | 无 | Debug |
| — Thinking (子类型) | 🧠 | Thinking | 灰色背景折叠块 | Debug, Session |
| — ToolCall (子类型) | 🔧 | Tool: {name} | 黄色背景块 | Debug, Session |
| ToolResult | 🛠️ | Tool: {name} | 橙色左边框 | Debug |
| — Error | ❌ | Error | 红色背景badge | Debug, Session |
| — Success | ✅ | OK | 绿色背景badge | Debug, Session |
| System/Header | ℹ️ | 系统 | 灰色左边框 | Session |
| Compact Boundary | 🗜️ | Compact | 黄色警告背景 | Session |

### CSS 命名约定

沿用现有 BEM-like 风格：
```
.message-role-badge    # 角色徽章（新增）
.message-subtype       # 子类型标记（新增）
.message-tool-status   # 工具状态标记（新增）
.message-timestamp     # 时间戳（新增）
.thinking-block        # 思考块（Session 已有，Debug 新增）
.tool-call-block       # 工具调用块（Session 已有，Debug 新增）
```

### 兼容性

- 保持现有 CSS class（`.message-item.user` 等）不变，避免破坏既有样式
- 新增 class 通过并列选择器叠加，不替换原有逻辑

## 5. Testing Strategy

### 5.1 手动验证清单

**Debug Inspector (`/debug`)**：
- [ ] Messages 标签页加载后，User 消息显示 👤 图标 + "用户" 标签
- [ ] Assistant 消息显示 🤖 图标 + "Assistant" 标签 + 绿色左边框
- [ ] Assistant 消息展开后，内部 thinking 内容显示 🧠 图标 + 可折叠块
- [ ] Assistant 消息展开后，内部 toolCall 显示 🔧 图标 + 工具名 + 参数块
- [ ] Assistant 消息展开后，内部 text 显示 💬 图标 + 正文
- [ ] ToolResult 消息显示 🛠️ 图标 + 工具名 + 状态badge（✅/❌）
- [ ] 错误状态的 ToolResult 边框变为红色
- [ ] 每条消息头部显示时间戳
- [ ] LLM View 标签页保持原有样式（不应用新标记）

**Session Viewer (`/sessions`)**：
- [ ] User entry 的 badge 从 "用户" 变为 👤 + "用户"
- [ ] Assistant entry 内部 thinking 折叠块显示 🧠 + "思考过程"
- [ ] Assistant entry 内部 toolCall 块显示 🔧 + 工具名
- [ ] ToolResult entry 的错误状态显示红色 ❌ badge
- [ ] ToolResult entry 的成功状态显示绿色 ✅ badge
- [ ] 现有边框颜色、布局不被破坏

### 5.2 边界情况

- 空 content 数组：不渲染任何子类型标记
- 未知 content 类型：回退到原始 JSON 展示
- 超长工具参数：保持现有滚动/截断逻辑

## 6. Boundaries

### 6.1 Always Do

- 只修改前端 HTML/CSS/JS（`debug.html.ts` 和 `sessions.html.ts`）
- 保持向后兼容：不删除现有 class、不改现有 API 路由
- 新增标记必须是纯视觉层，不改变数据结构或交互逻辑
- 在 worktree 中开发，通过 PR 合并

### 6.2 Ask First

- 如果要修改后端 API 返回的数据结构
- 如果要引入外部图标库（如 FontAwesome）替代 emoji
- 如果要修改消息的交互行为（如折叠/展开逻辑）
- 如果要改 TUI 代码以保持一致性

### 6.3 Never Do

- 不改 `debug-api.ts` 或 `session-api.ts`
- 不改 Agent 内核、LLM 类型定义
- 不改 TUI 组件
- 不引入新的前端框架或构建工具
- 不改动会话持久化格式（`entry-types.ts`）
- 不在 main 分支直接提交

## 7. Implementation Plan

### Phase 1: Debug Inspector 增强
1. 增强 `renderMessageList` 函数，按 role 分发到专用渲染器
2. 为 User 消息添加 👤 图标 + 时间戳
3. 为 Assistant 消息添加 🤖 图标 + 内部子类型解析（thinking/toolCall/text）
4. 为 ToolResult 消息添加 🛠️ 图标 + 工具名 + 状态badge
5. 添加对应 CSS 样式

### Phase 2: Session Viewer 增强
1. 更新 `renderEntryCard`，为各 entry type 添加图标
2. 更新 `renderEntryContent`，增强 thinking/toolCall/toolResult 的视觉标记
3. 调整 badge 样式，增加图标间距

### Phase 3: 验证
1. 启动应用，创建测试会话
2. 按 Testing Strategy 逐项验证
3. 截图对比确认视觉效果
