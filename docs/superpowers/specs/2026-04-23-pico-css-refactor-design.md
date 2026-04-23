# Pico.css 前端重构设计文档

> **目标：** 用 Pico.css CDN 重构 Web 前端页面，统一 UI 风格，大幅精简 CSS 代码量，建立 Home 页到 Session Viewer 的导航。

**架构：** 前后端一体架构不变，仅替换前端页面的 CSS 框架和 HTML 结构。

**技术栈：** Bun (HTTP server) + Pico.css (CDN) + 原生 HTML/JS

---

## 背景

当前前端页面使用原生 CSS 编写，Session Viewer 的 CSS 约 700+ 行，维护成本高。Home 页和 Session Viewer 之间没有导航关联，体验割裂。

Pico.css 是一个 classless CSS 框架（8KB），通过语义化 HTML 自动美化原生标签，支持暗色主题，无需构建步骤，适合工具型项目。

---

## 设计决策

### 1. 引入 Pico.css CDN

不增加构建步骤，不修改后端逻辑，仅在 HTML 中引入 CDN 链接：

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
<html data-theme="dark">
```

**理由：**
- 零构建步骤，零额外依赖
- classless 设计，不需要在 HTML 中写大量 class
- 暗色主题一行代码开启
- 表格、按钮、卡片、导航等组件自动美化

### 2. Home 页作为导航入口

当前 Home 页仅显示 "ys-code web server is running" 和 PID，功能单一。重构后增加功能导航：

- **Session Viewer** — 主入口，查看对话历史记录
- **Health Check** — 查看服务状态

### 3. Session Viewer 重构范围

保留原有功能和交互（列表视图、详情视图、hash 路由、搜索过滤），但用 Pico.css 替换通用样式：

| 样式模块 | 当前 | 重构后 |
|---------|------|--------|
| 布局（flexbox 框架） | ~50 行自定义 | 保留 Pico 不管布局 |
| 按钮/表格/卡片 | ~150 行 | 删除，Pico 自动处理 |
| 表单元素 | ~80 行 | 删除 |
| 颜色/暗色主题 | ~200 行 | 删除，`data-theme="dark"` |
| 弹窗/折叠 | ~100 行 | 删除，Pico 内置 details/summary |
| entry 颜色定制 | ~120 行 | 保留（user 蓝色、assistant 绿色等） |

预计 CSS 从 700+ 行降到 ~150 行。

---

## 文件结构

```
src/web/pages/
├── home.html.ts        # 重构：Pico.css + 导航卡片
└── sessions.html.ts    # 重构：Pico.css + 精简 CSS
```

**不新增文件，不修改后端逻辑。**

---

## Home 页设计

### 布局

```
┌─────────────────────────────────────────┐
│  ys-code                           [?]  │
├─────────────────────────────────────────┤
│                                         │
│     ys-code Web Server is running       │
│                                         │
│     PID: 63446                          │
│     Uptime: 12m                         │
│     Session Dir: ~/.ys-code/sessions    │
│                                         │
│     ┌───────────────────────┐          │
│     │ 📂 Session Viewer     │          │
│     │    查看对话历史记录    │          │
│     └───────────────────────┘          │
│                                         │
│     ┌───────────────────────┐          │
│     │ 💓 Health Check       │          │
│     │    /health            │          │
│     └───────────────────────┘          │
│                                         │
├─────────────────────────────────────────┤
│  ys-code | PID: 63446 | 127.0.0.1     │
└─────────────────────────────────────────┘
```

### 技术实现

- 使用 Pico.css 的 `article` 卡片和 `button` 样式
- 暗色主题通过 `data-theme="dark"` 开启
- Session Viewer 卡片链接到 `/sessions`
- Health Check 卡片链接到 `/health`（新标签页打开 JSON）
- 底部显示 PID、监听地址等元信息

---

## Session Viewer 重构设计

### 布局调整

保持现有结构（标题栏 + sidebar + 主内容 + 底部状态栏），但使用 Pico.css 的基础样式：

- 标题栏：保留自定义样式（Pico 不管顶部导航）
- Sidebar：保留自定义宽度（280px），内部使用 Pico 的 `nav` 和 `details`
- 主内容区：表格用原生 `<table>`（Pico 自动美化）
- 搜索框：用 Pico 的 `input` 样式
- 底部状态栏：保留自定义

### Entry 样式保留

以下样式需要保留自定义 CSS，因为 Pico.css 不覆盖：

| Entry 类型 | 保留样式 |
|-----------|---------|
| header | 灰色背景卡片 |
| user | 蓝色左边框 |
| assistant | 绿色左边框 + model/token 元信息 |
| thinking | 折叠块（可用 Pico 的 details/summary）|
| toolCall | 灰色卡片 + JSON 参数 |
| toolResult | 浅灰色左边框 |
| compact_boundary | 黄色警告背景 |

### thinking 折叠优化

当前使用自定义 JS onclick 实现折叠。重构后可用 Pico 内置的 `details/summary`：

```html
<details>
  <summary>思考过程</summary>
  <p>...thinking content...</p>
</details>
```

这样不需要 JavaScript 即可实现折叠/展开。

---

## API 不变

后端接口完全不变：

- `GET /` — 返回 Home 页 HTML
- `GET /sessions` — 返回 Session Viewer HTML
- `GET /api/sessions` — 返回 session 列表 JSON
- `GET /api/sessions/:filename` — 返回 session 详情 JSON
- `GET /health` — 返回健康状态 JSON

---

## 安全与性能

| 措施 | 说明 |
|------|------|
| CDN 可用性 | Pico.css 使用 jsdelivr CDN，如不可用页面样式会失效，但功能不受影响 |
| 暗色主题 | `data-theme="dark"` 在 html 标签上设置，全局生效 |
| 响应式 | Pico.css 自带响应式，无需额外处理 |

---

## 后续扩展

当前 Home 页只放 Session Viewer 和 Health Check。未来如有新功能：

- Metrics 监控 → 新增卡片链接到 `/metrics`
- Settings 配置 → 新增卡片链接到 `/settings`
- 无需修改 Home 页结构，直接新增 `article` 卡片即可

---

## Spec 自审

1. **Placeholder scan**：无 TBD/TODO
2. **内部一致性**：Home 页和 Session Viewer 都用 Pico.css，风格统一
3. **Scope check**：仅重构前端页面，不涉及后端逻辑
4. **Ambiguity check**：CDN 地址、暗色主题开启方式已明确
