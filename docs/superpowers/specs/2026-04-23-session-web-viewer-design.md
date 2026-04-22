# Session Web Viewer 设计文档

> **目标：** 为 ys-code 添加一个基于浏览器的 session 预览工具，方便开发调试时查看对话历史。

**架构：** 单进程双模式 — TUI 与 HTTP server 共存于同一个 Bun 进程，共享 session 文件。前端使用纯 HTML + JS，无需构建工具。

**技术栈：** Bun (HTTP server) + 原生 HTML/JS/CSS

---

## 背景与动机

当前 ys-code 的 session 以 JSONL 格式存储在 `~/.ys-code/sessions/` 目录下。开发调试时需要频繁查看 session 内容，但直接阅读原始 JSONL 文件体验差：

- 内容块嵌套深（thinking、toolCall、text 混合）
- 无法直观看到对话流转
- 元信息（token 用量、模型名称）分散在各 entry 中

一个轻量的 Web 预览工具可以显著提升调试效率。

---

## 设计决策

### 1. 同进程架构（已验证可行）

```
Bun Process
├── Ink TUI（stdin/stdout）
└── Bun.serve()（HTTP，自动端口）
    └── 读取 ~/.ys-code/sessions/*.jsonl
```

**决策理由：**
- 生命周期一致，退出 TUI 自动关闭 server
- 不需要额外进程管理，无僵尸进程风险
- 共享磁盘文件，无需进程间通信

**验证结果：**
- Health check 正常响应
- 5 并发 stress 测试通过
- TUI 定时器不受 HTTP 请求影响

### 2. 纯前端渲染（无构建步骤）

前端使用单文件 HTML + 原生 JS，不依赖 React/Vue/Webpack 等构建工具。

**决策理由：**
- 工具定位是"开发调试辅助"，不应引入复杂构建链
- 单文件即可运行，部署/分享方便
- 数据量不大（单个 session 通常 < 1MB），原生 DOM 操作性能足够

### 3. 只读设计

第一阶段仅支持浏览和搜索，不修改 session 数据。

**决策理由：**
- 调试场景以"查看"为主
- 避免意外修改生产 session 文件
- 未来如需编辑功能可扩展

---

## 功能设计

### 功能 1：Session 文件列表

启动 `--web` 后，浏览器默认展示 `~/.ys-code/sessions/` 目录下的所有 `.jsonl` 文件：

| 展示字段 | 来源 |
|---------|------|
| 文件名 | 文件系统 |
| 创建时间 | header entry 的 timestamp |
| 消息数 | entry 类型为 user/assistant/toolResult 的数量 |
| 是否 compacted | 是否存在 compact_boundary entry |

### 功能 2：对话流时间线

点击某个 session 后，以时间线形式展示对话过程：

```
[系统] 2025-04-23 10:00:01
  Session started in /Users/carlyu/project

[用户] 10:00:15
  帮我写一个快速排序

[AI] 10:00:18 (MiniMax-M2.7-highspeed)
  好的，这是快速排序的实现...
  [思考过程] 用户要求快速排序...
  [工具调用] Bash: ls -la

[工具结果] 10:00:19
  total 560
  drwxr-xr-x ...

[Compact] 10:05:00
  摘要：用户要求快速排序，AI 提供了实现...
  Token: 12450 → 320
```

### 功能 3：结构化内容展示

不同类型的 entry 用不同样式区分：

- **user**：蓝色边框，左侧头像
- **assistant**：绿色边框，展示 model 名称和 token 用量
- **thinking**：折叠状态，默认隐藏，可点击展开
- **toolCall**：灰色背景，展示工具名和参数
- **toolResult**：浅灰色，展示返回结果（截断过长的文本）
- **compact_boundary**：黄色警告背景，展示摘要和压缩比例

### 功能 4：搜索过滤

顶部搜索栏支持：
- 按内容关键词搜索（匹配 user.content / assistant.content.text / toolResult.content.text）
- 按类型过滤（只看 user / 只看 assistant / 只看 toolCall）
- 按时间范围过滤（最近 1 小时 / 今天 / 全部）

### 功能 5：元信息面板

选中某条 assistant message 后，右侧（或下方）展示元信息：

```
模型：MiniMax-M2.7-highspeed
Token：input 1250 / output 680 / cacheRead 0 / cacheWrite 3200
总消耗：4930 tokens
停止原因：toolUse
耗时：~3.2s（从上一轮到本轮的时间差）
```

---

## API 设计

Bun.serve() 提供以下端点：

```typescript
// GET /api/sessions
// 返回 session 文件列表
interface SessionListResponse {
  sessions: Array<{
    fileName: string;
    sessionId: string;
    createdAt: number;
    entryCount: number;
    messageCount: number;
    hasCompact: boolean;
  }>;
}

// GET /api/sessions/:fileName
// 返回单个 session 的所有 entries（已解析为 JSON）
interface SessionDetailResponse {
  fileName: string;
  header: HeaderEntry;
  entries: Entry[];
  stats: {
    userCount: number;
    assistantCount: number;
    toolResultCount: number;
    compactCount: number;
    totalTokens: number;
  };
}

// GET /health
// 健康检查
interface HealthResponse {
  status: "ok";
  pid: number;
  timestamp: number;
  sessionDir: string;
}
```

---

## 前端设计

### 页面结构

```
┌─────────────────────────────────────────────┐
│  ys-code Session Viewer                [?]  │  ← 顶部标题栏
├──────────┬──────────────────────────────────┤
│          │  🔍 Search... [类型▼] [时间▼]   │  ← 搜索过滤栏
│ Session  ├──────────────────────────────────┤
│ List     │                                  │
│          │  [系统] 10:00:01                 │
│ • file1  │      Session started...          │
│ • file2  │                                  │
│ • file3  │  [用户] 10:00:15                 │
│          │      帮我写快速排序              │
│          │                                  │
│          │  [AI] 10:00:18 ▼                 │
│          │      MiniMax-M2.7-highspeed      │
│          │      Token: 4930                 │
│          │      ────────────────────────    │
│          │      好的，这是快速排序...       │
│          │      [思考 ▼] [工具: Bash ▼]    │
│          │                                  │
│          │  [工具结果] 10:00:19             │
│          │      total 560...                │
│          │                                  │
│          ├──────────────────────────────────┤
│          │  共 56 条 entries | 3.2 MB      │  ← 底部状态栏
└──────────┴──────────────────────────────────┘
```

### 技术选型

- **布局**：CSS Flexbox，左侧 sidebar 250px，右侧主区域自适应
- **样式**：原生 CSS，不引入 Tailwind/Bootstrap（避免构建步骤）
- **交互**：原生 JS + DOM API，不引入 Vue/React（避免构建步骤）
- **代码高亮**：如需展示代码块，使用 highlight.js CDN 版本（按需加载）

### 文件结构

```
static/
├── session-viewer.html      # 主页面（单文件，包含 CSS + HTML + JS）
└── assets/
    ├── styles.css           # 样式（可从 HTML 分离，也可内联）
    └── app.js               # 前端逻辑（可从 HTML 分离，也可内联）
```

**第一阶段建议**：所有内容内联在 `session-viewer.html` 中，单文件即可运行，无需担心资源路径问题。

---

## CLI 集成

### 启动方式

```bash
# 方式 1：启动 TUI 时同时开启 web 预览
ys-code --web

# 方式 2：单独启动 web 预览（不启动 TUI）
ys-code --web-only
```

### 实现位置

修改 `src/cli/` 或 `src/agent/` 模块：

```typescript
// src/cli/main.ts 或类似位置
if (args.web || args.webOnly) {
  const server = createSessionServer({
    sessionDir: getSessionDir(),
    port: args.port ?? 0,  // 0 = 自动分配
  });
  
  console.log(`Session viewer: http://localhost:${server.port}`);
  
  if (args.webOnly) {
    // 保持进程运行，不启动 TUI
    process.stdin.resume();
  }
}

if (!args.webOnly) {
  // 启动 TUI
  startTUI();
}
```

### 端口管理

- 默认 `port: 0`（自动分配，避免冲突）
- 可选 `--port 8080` 指定固定端口
- 启动时打印完整 URL：`http://localhost:<port>`

---

## 安全与隐私

| 风险 | 缓解措施 |
|------|---------|
| session 文件包含敏感代码/密钥 | 仅绑定 `127.0.0.1`，拒绝外部访问 |
| 浏览器跨域问题 | 同域访问，无需 CORS |
| 意外泄露 | `--web` 默认关闭，需显式开启 |

```typescript
Bun.serve({
  hostname: "127.0.0.1",  // 仅本地访问
  port: 0,
  // ...
});
```

---

## 后续扩展（非第一阶段）

- **实时同步**：WebSocket 推送新 entry，无需刷新页面
- **对比模式**：并排对比两个 session 的差异
- **导出功能**：导出为 Markdown / HTML 报告
- **性能优化**：Virtual scrolling（处理超长 session）

---

## Spec 自审

1. **Placeholder scan**：无 TBD/TODO，所有接口和路径已定义
2. **内部一致性**：API 返回的 Entry 类型与 `src/session/entry-types.ts` 一致
3. **Scope check**：聚焦"只读预览"，编辑功能明确排除在第一阶段外
4. **Ambiguity check**：启动方式（`--web` / `--web-only`）、端口行为（自动分配）已明确

---

## 任务拆分建议（供 writing-plans 参考）

1. **HTTP Server 骨架** — Bun.serve() + health check + session 列表 API
2. **前端单文件页面** — HTML 框架 + sidebar + 主区域布局
3. **Session 列表渲染** — 调用 `/api/sessions`，展示文件列表和基础信息
4. **对话流时间线** — 解析 entry 类型，按时间顺序渲染不同样式
5. **搜索过滤功能** — 前端关键词搜索 + 类型过滤
6. **元信息面板** — assistant entry 的 token/model/stopReason 展示
7. **CLI 集成** — `--web` / `--web-only` 参数解析和启动逻辑
8. **端到端验证** — 完整流程测试
