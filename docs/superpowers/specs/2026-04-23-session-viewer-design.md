# Session Web Viewer 设计文档

> **目标：** 在已实现的 web 框架基础上，添加 session 预览功能。通过浏览器访问 `http://127.0.0.1:<port>/sessions` 查看 `~/.ys-code/sessions/` 目录下的对话历史。

**架构：** 复用现有 `src/web/` 模块，通过 `registerRoute()` 新增 API 和页面路由。前端为单文件 HTML（内嵌 CSS/JS），无构建步骤。

**技术栈：** Bun (HTTP server) + 原生 HTML/JS/CSS

---

## 背景

当前 session 以 JSONL 格式存储在 `~/.ys-code/sessions/` 下。直接阅读原始 JSONL 体验差（嵌套深、元信息分散）。在已验证的 web 框架上添加一个只读的 session 预览页面，可以显著提升调试效率。

---

## 设计决策

### 1. 复用现有 web 框架

不新建 server，不修改 `src/web/server.ts` 或 `src/main.ts`。仅通过 `registerRoute()` 在现有路由系统上注册新端点。

**理由：**
- web 框架已经实现并验证（health check、自动端口、SIGINT 清理）
- `registerRoute()` 就是为扩展设计的
- 避免重复造轮子

### 2. 精确匹配路由下的手动解析

现有路由系统使用 `Map<string, RouteHandler>` 做精确匹配，不支持 `/api/sessions/:filename` 这种模式。

**方案：** 注册一个 `/api/sessions` handler，内部手动解析 URL path：

```typescript
const url = new URL(request.url);
const path = url.pathname;

if (path === "/api/sessions") {
  return listSessions();        // 返回文件列表
}

const match = path.match(/^\/api\/sessions\/(.+)$/);
if (match) {
  return getSession(match[1]);  // 返回单个 session 详情
}
```

同理，`/sessions` handler 返回 HTML 页面，前端用 hash 路由切换视图。

### 3. 单页应用 + Hash 路由

前端只有一个 HTML 页面 `/sessions`：
- `/#/` 或空 hash → 列表视图
- `#/filename.jsonl` → 详情视图（对话流时间线）

**理由：**
- 服务端只需要注册一个 `/sessions` 路由，最简单
- hash 变化不触发页面刷新，纯前端切换
- 用户刷新页面不会丢失当前查看的 session

### 4. 只读设计

第一阶段仅支持浏览和搜索，不修改 session 数据。

---

## API 设计

### GET /api/sessions

返回 session 文件列表。

```typescript
interface SessionListItem {
  fileName: string;      // "1776793565665_02af5cbc-e5d2-4dec-a698-e7a886a966ff.jsonl"
  sessionId: string;     // header.sessionId
  createdAt: number;     // header.timestamp
  entryCount: number;    // 总 entry 数
  messageCount: number;  // user + assistant + toolResult 数量
  hasCompact: boolean;   // 是否存在 compact_boundary
}

interface SessionListResponse {
  sessions: SessionListItem[];
}
```

**实现逻辑：**
1. 读取 `~/.ys-code/sessions/*.jsonl`
2. 对每个文件读取第一行（header entry）
3. 快速扫描全部行数（不解析 JSON，仅数换行符）
4. 返回列表（按 createdAt 倒序）

### GET /api/sessions/:filename

返回单个 session 的所有 entries。

```typescript
interface SessionDetailResponse {
  fileName: string;
  header: HeaderEntry;
  entries: Entry[];
  stats: {
    userCount: number;
    assistantCount: number;
    toolResultCount: number;
    compactCount: number;
    totalTokens: number;   // 所有 assistant.usage.totalTokens 之和
  };
}
```

**实现逻辑：**
1. 校验 filename（只允许 `.jsonl` 后缀，禁止 `..` 路径穿越）
2. 按行读取文件，逐行 `JSON.parse`
3. 统计各类型数量和 token 总数
4. 返回完整 entries 数组

### 扩展 Health Check

在现有 `/health` 响应中增加 `sessionDir` 字段：

```typescript
interface HealthResponse {
  status: "ok";
  service: "ys-code";
  pid: number;
  timestamp: number;
  uptime: number;
  sessionDir: string;  // 新增
}
```

---

## 前端设计

### 页面路由（Hash）

| URL | 视图 |
|-----|------|
| `/sessions` | Session 列表 |
| `/sessions#/xxx.jsonl` | 某个 session 的对话流 |

### 布局

```
┌─────────────────────────────────────────────┐
│  ys-code Session Viewer                [?]  │
├──────────┬──────────────────────────────────┤
│          │  🔍 Search... [类型▼] [时间▼]   │
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
│          │  共 56 条 entries | 3.2 MB      │
└──────────┴──────────────────────────────────┘
```

### Entry 样式

| 类型 | 样式 |
|------|------|
| header | 灰色背景，展示 cwd 和 sessionId |
| user | 蓝色边框，展示文本内容 |
| assistant | 绿色边框，顶部展示 model 名称和总 token |
| thinking | 折叠块，默认隐藏，点击展开 |
| toolCall | 灰色卡片，展示 `工具名: 参数` |
| toolResult | 浅灰色，文本内容（过长截断 + 展开） |
| compact_boundary | 黄色警告背景，展示摘要和压缩比例 |

### 技术选型

- **布局**：CSS Flexbox，左侧 sidebar 280px，右侧主区域自适应
- **样式**：原生 CSS，暗色主题（匹配终端体验）
- **交互**：原生 JS + DOM API
- **代码高亮**：如需要，使用 highlight.js CDN

---

## 文件结构

```
src/web/
├── index.ts                    # 已有，不变
├── types.ts                    # 已有，不变
├── server.ts                   # 已有，不变
├── routes.ts                   # 修改：注册 /api/sessions、/sessions 路由
├── session-api.ts              # 新增：session 数据读取和解析
└── pages/
    ├── home.html.ts            # 已有，不变
    └── sessions.html.ts        # 新增：Session Viewer 单页应用
```

### 新增/修改文件说明

| 文件 | 职责 |
|------|------|
| `routes.ts` | 在 `buildRouter()` 中注册 `/api/sessions` 和 `/sessions` |
| `session-api.ts` | 读取 `~/.ys-code/sessions/` 目录，解析 JSONL，生成响应数据 |
| `pages/sessions.html.ts` | 导出 `SESSIONS_HTML` 字符串常量，包含完整的 HTML/CSS/JS |

---

## 路由注册

在 `src/web/routes.ts` 的 `buildRouter()` 中，注册 home 路由之后、返回 router 之前，添加：

```typescript
import { handleSessionAPI } from "./session-api.js";
import { SESSIONS_HTML } from "./pages/sessions.html.js";

// 在 buildRouter 中：
if (!routes.has("/api/sessions")) {
  registerRoute("/api/sessions", handleSessionAPI);
}

if (!routes.has("/sessions")) {
  registerRoute("/sessions", () => {
    return new Response(SESSIONS_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}
```

---

## 安全设计

| 风险 | 缓解措施 |
|------|---------|
| 路径穿越 | API 中校验 filename，拒绝包含 `..` 的路径 |
| 大文件 | 读取 JSONL 时使用流式方式，限制单个文件最大 50MB |
| 敏感信息泄露 | 仅绑定 `127.0.0.1`；health check 不暴露文件内容 |

---

## 实现计划

### Task 1: Session API 模块
- 创建 `src/web/session-api.ts`
- 实现 `listSessions()`：读取目录、解析 header、统计行数
- 实现 `getSession(filename)`：读取文件、解析 JSONL、统计信息
- 实现 `handleSessionAPI(req)`：路由分发（列表 vs 详情）
- 测试：`src/web/session-api.test.ts`

### Task 2: Session Viewer 前端页面
- 创建 `src/web/pages/sessions.html.ts`
- 编写单文件 HTML（CSS + JS 内联）
- 实现列表视图：调用 `/api/sessions`
- 实现详情视图：调用 `/api/sessions/:filename`，渲染对话流
- 实现 hash 路由切换
- 实现搜索过滤（前端过滤）

### Task 3: 路由集成
- 修改 `src/web/routes.ts`
- 注册 `/api/sessions` 和 `/sessions` 路由
- 扩展 `/health` 响应，增加 `sessionDir`
- 端到端测试：启动 server，验证页面可访问、API 返回正确

---

## Spec 自审

1. **Placeholder scan**：无 TBD/TODO
2. **内部一致性**：API 类型与 `src/session/entry-types.ts` 一致；路由注册方式与现有框架一致
3. **Scope check**：只读预览，不涉及编辑/删除
4. **Ambiguity check**：路由解析方式（handler 内手动解析）已明确
