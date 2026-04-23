# ys-code Web 模块源码理解笔记

## 整体认知

**定位：** 为纯 TUI 工具提供可选的 Web 能力，单进程双模式运行。

**系统位置：**

```
ys-code 进程
├─ CLI 入口 (src/main.ts)
├─ Ink TUI (src/tui/)
└─ Web 模块 (src/web/)
   ├─ server.ts — Bun.serve() 生命周期管理
   ├─ routes.ts — 路由注册中心（精确匹配 + 前缀匹配）
   ├─ session-api.ts — Session 数据读取和 API 响应
   └─ pages/*.html.ts — 内嵌前端页面（HTML/CSS/JS 字符串常量）
```

**输入：** `--web` CLI 参数、HTTP 请求、磁盘 session 文件
**输出：** HTTP 响应（JSON/HTML）、浏览器可访问的 URL

## 关键设计决策

### 1. 前后端一体，无独立前端服务器

- Bun.serve() 同时处理 API 和页面请求
- 前端资源以内嵌字符串形式存在，无 `static/` 目录
- 零构建步骤，零额外依赖

### 2. 路由系统：精确匹配 + 前缀匹配

```
请求到达 → 精确匹配路由表 → 未命中则前缀匹配 → 仍未命中则 404
```

前缀匹配用于支持 `/api/sessions/:filename` 这类子路径。

### 3. 单页应用 + Hash 路由

- `/sessions` 返回一个 HTML 页面
- 前端通过 `#/filename.jsonl` 切换详情视图
- 服务端只需一个路由，所有视图逻辑在前端

## 当前局限

- 原生 HTML/JS 代码量随功能增长（当前 1242 行）
- 无组件化复用机制
- Home 页和 Session Viewer 无导航关联

## 演进方向

如需继续扩展，可考虑：
- 统一 UI 框架（React/Vue）+ 构建步骤
- Home 页作为功能导航入口
- 各功能模块（Session Viewer、Metrics、Settings 等）作为子页面
