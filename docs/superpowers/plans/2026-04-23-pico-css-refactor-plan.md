# Pico.css 前端重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Pico.css CDN 重构 Home 页和 Session Viewer 页面，统一暗色主题 UI，大幅精简 CSS，建立 Home → Session Viewer 导航。

**Architecture:** 仅修改 `src/web/pages/*.html.ts`，后端路由和 API 完全不变。

**Tech Stack:** Pico.css (CDN) + 原生 HTML/JS

---

## 文件结构

```
src/web/pages/
├── home.html.ts        # 重构
└── sessions.html.ts    # 重构
```

---

### Task 1: 重构 Home 页

**Files:**
- Modify: `src/web/pages/home.html.ts`
- Test: `src/web/e2e.test.ts`（验证首页可访问）

- [ ] **Step 1: 编写 Home 页 HTML**

```typescript
export const HOME_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ys-code</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    /* 仅保留布局相关自定义样式 */
    body { padding: 0; margin: 0; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    .hero { text-align: center; margin-bottom: 3rem; }
    .hero h1 { margin-bottom: 0.5rem; }
    .hero p { color: var(--pico-muted-color); }
    .nav-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 768px) {
      .nav-grid { grid-template-columns: 1fr; }
    }
    .nav-card {
      text-decoration: none;
      transition: transform 0.2s;
    }
    .nav-card:hover {
      transform: translateY(-2px);
    }
    .nav-card article {
      margin: 0;
      height: 100%;
    }
    .nav-card h3 {
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .nav-card p {
      margin: 0;
      color: var(--pico-muted-color);
    }
    .status-bar {
      text-align: center;
      padding: 1rem;
      border-top: 1px solid var(--pico-muted-border-color);
      font-size: 0.875rem;
      color: var(--pico-muted-color);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <h1>ys-code</h1>
      <p>AI-powered coding assistant</p>
    </div>

    <div class="nav-grid">
      <a href="/sessions" class="nav-card">
        <article>
          <h3>📂 Session Viewer</h3>
          <p>查看对话历史记录</p>
        </article>
      </a>
      <a href="/health" target="_blank" class="nav-card">
        <article>
          <h3>💓 Health Check</h3>
          <p>检查服务运行状态</p>
        </article>
      </a>
    </div>

    <div class="status-bar">
      <span id="status">加载中...</span>
    </div>
  </div>

  <script>
    fetch('/health')
      .then(r => r.json())
      .then(d => {
        document.getElementById('status').textContent = 
          'PID: ' + d.pid + ' | Uptime: ' + d.uptime + 's | ' + d.service;
      })
      .catch(() => {
        document.getElementById('status').textContent = '服务状态异常';
      });
  </script>
</body>
</html>`;
```

- [ ] **Step 2: 运行现有测试确认 Home 页可访问**

```bash
bun test src/web/e2e.test.ts
```

Expected: PASS (首页返回 200)

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/home.html.ts
git commit -m "feat(web): refactor home page with Pico.css and navigation"
```

---

### Task 2: 重构 Session Viewer 页面

**Files:**
- Modify: `src/web/pages/sessions.html.ts`
- Test: 手动浏览器验证（页面难以单元测试）

- [ ] **Step 1: 替换 HTML 骨架和引入 Pico.css**

在 `<head>` 中：
1. 添加 `<html data-theme="dark">`
2. 添加 Pico.css CDN link
3. 删除所有通用 CSS（按钮、表格、表单、颜色变量等）
4. 仅保留：
   - 布局相关（flexbox、sidebar 宽度、header/footer 高度）
   - entry 类型颜色定制（user 蓝色、assistant 绿色等）

- [ ] **Step 2: 替换自定义组件为 Pico 语义化标签**

| 原有实现 | Pico 替换 |
|---------|----------|
| 自定义表格样式 | 原生 `<table>`（Pico 自动美化）|
| 自定义按钮 | 原生 `<button>` 或 `<a role="button">` |
| 自定义输入框 | 原生 `<input>`（Pico 自动美化）|
| 自定义弹窗 | 保留现有实现（Pico 无弹窗组件）|
| 自定义折叠块 | `<details><summary>`（Pico 自动美化）|
| 自定义卡片 | `<article>`（Pico 自动美化）|

- [ ] **Step 3: 优化 thinking 折叠**

将自定义 onclick 折叠改为 `<details>` + `<summary>`：

```javascript
// 替换前
html += '<div class="thinking-header" onclick="...">思考过程 ▼</div>';
html += '<div class="thinking-body">' + content + '</div>';

// 替换后
html += '<details>';
html += '<summary>思考过程</summary>';
html += '<p>' + escapeHtml(item.thinking) + '</p>';
html += '</details>';
```

- [ ] **Step 4: 验证类型检查**

```bash
bunx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 5: 浏览器手动验证**

```bash
bun run src/main.ts --web
```

验证项：
- [ ] 列表页正常显示，表格有 Pico 样式
- [ ] 详情页正常显示，entry 颜色正确
- [ ] thinking 折叠可用
- [ ] 搜索过滤可用
- [ ] 暗色主题生效

- [ ] **Step 6: Commit**

```bash
git add src/web/pages/sessions.html.ts
git commit -m "feat(web): refactor session viewer with Pico.css

- Replace 700+ lines custom CSS with Pico.css CDN
- Use semantic HTML: table, article, details/summary
- Keep only layout and entry color customizations
- Dark theme via data-theme=dark"
```

---

### Task 3: 端到端验证

**Files:**
- Run: `src/web/session-viewer-e2e.test.ts`
- Run: `src/web/e2e.test.ts`

- [ ] **Step 1: 运行全部 web 测试**

```bash
bun test src/web/
```

Expected: 所有测试通过

- [ ] **Step 2: 验证 Home → Session Viewer 导航**

1. 访问 `/` — 确认 Pico 暗色主题生效
2. 点击 "Session Viewer" 卡片 — 确认跳转到 `/sessions`
3. 确认 Session Viewer 页面 Pico 样式生效

- [ ] **Step 3: Commit（如有测试更新）**

---

## Spec 覆盖检查

| 设计文档要求 | 实现任务 | 状态 |
|-------------|---------|------|
| Pico.css CDN 引入 | Task 1/2 | ✅ |
| 暗色主题 data-theme="dark" | Task 1/2 | ✅ |
| Home 页导航卡片 | Task 1 | ✅ |
| Session Viewer 精简 CSS | Task 2 | ✅ |
| thinking 折叠改为 details | Task 2 | ✅ |
| 后端不变 | — | ✅ |
| 测试通过 | Task 3 | ✅ |

---

## Placeholder 检查

- [x] 无 "TBD" / "TODO" / "implement later"
- [x] 所有步骤包含可执行命令
- [x] 无未定义的类型/函数引用

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-04-23-pico-css-refactor-plan.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
