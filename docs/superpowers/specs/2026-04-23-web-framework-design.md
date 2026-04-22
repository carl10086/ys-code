# ys-code Web 框架设计文档

> **目标：** 为 ys-code 建立可嵌入的 HTTP Server 技术框架，支持通过 `--web` 参数在启动 TUI 时同时暴露 Web 能力。

**架构：** 单进程双模式 — Ink TUI 与 Bun HTTP Server 共存于同一个进程，通过 `Bun.serve()` 实现。

**技术栈：** Bun (内置 HTTP server) + 原生 HTML/JS/CSS

---

## 背景与动机

ys-code 目前是一个纯 CLI/TUI 工具。随着功能演进，我们需要一个轻量的 Web 能力来：

- 提供可视化调试界面（如 session 预览、性能监控）
- 暴露 HTTP API 供外部工具集成
- 为未来的 Web 扩展奠定基础

**核心约束：**
- 不引入额外进程（避免进程管理复杂度）
- 不破坏现有 TUI 体验（`--web` 是可选的）
- 不引入重型 Web 框架（保持轻量）

---

## 设计决策

### 1. 同进程架构（已验证）

```
Bun Process (PID: xxx)
┌─────────────────────────────────────────┐
│  CLI 参数解析 ( Commander )              │
│         │                               │
│    ┌────┴────┐                          │
│    ▼         ▼                          │
│  Ink TUI   Bun.serve()  ← 可选并行启动   │
│  (主模式)   (辅助模式)                   │
│    │         │                          │
│    └────┬────┘                          │
│         ▼                               │
│    共享 session 文件/状态                │
└─────────────────────────────────────────┘
```

**验证结论：**
- Health check 正常响应 ✅
- 5 并发 stress 测试通过 ✅
- TUI 定时器不受 HTTP 请求影响 ✅

### 2. Bun.serve() 作为唯一 HTTP 引擎

不使用 Express/Fastify/Koa 等框架，直接使用 Bun 内置的 `Bun.serve()`。

**决策理由：**
- Bun.serve() 性能最优（原生实现，无中间层）
- 零额外依赖（Bun 已内置）
- 支持路由、WebSocket、静态文件（Bun v1.1+）

### 3. 静态文件内嵌策略

前端资源（HTML/CSS/JS）不放在磁盘上，而是内嵌在 TypeScript 源码中，编译时打包进可执行文件。

**决策理由：**
- 避免运行时依赖文件系统路径（`static/` 目录可能不存在）
- 分发简单（单文件可执行）
- 版本一致性（代码和资源永远同步）

**实现方式：**
```typescript
// 使用 Bun 的 embedded file 或字符串模板
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>...</html>
`;

Bun.serve({
  routes: {
    "/": () => new Response(HTML_TEMPLATE, { headers: { "Content-Type": "text/html" } }),
  }
});
```

---

## 模块设计

### 新增模块：`src/web/`

```
src/web/
├── index.ts              # 模块入口，暴露 createServer / stopServer
├── server.ts             # Bun.serve() 封装
├── routes.ts             # 路由注册中心
├── types.ts              # Web 框架类型定义
└── pages/                # 内嵌页面资源
    ├── home.html.ts      # 首页 HTML（字符串常量）
    └── home.css.ts       # 首页 CSS（字符串常量）
```

### 模块职责

| 文件 | 职责 |
|------|------|
| `server.ts` | 封装 `Bun.serve()`，管理启动/停止/端口 |
| `routes.ts` | 路由注册表，支持动态添加/移除路由 |
| `index.ts` | 对外 API：`createWebServer(options)` / `stopWebServer()` |
| `pages/*.ts` | 前端页面资源（HTML/CSS/JS 字符串） |

---

## API 设计

### 对外接口（供 CLI/TUI 调用）

```typescript
// src/web/types.ts

/** Web 服务器配置 */
export interface WebServerConfig {
  /** 绑定端口，0 表示自动分配 */
  port?: number;
  /** 绑定地址，默认 127.0.0.1 */
  hostname?: string;
  /** 是否自动打印访问 URL */
  silent?: boolean;
}

/** Web 服务器实例 */
export interface WebServer {
  /** 实际监听的端口 */
  port: number;
  /** 访问 URL */
  url: string;
  /** 停止服务器 */
  stop(): void;
}

// src/web/index.ts

/**
 * 创建并启动 Web 服务器
 * @param config 服务器配置
 * @returns WebServer 实例
 */
export function createWebServer(config?: WebServerConfig): WebServer;

/**
 * 停止当前运行的 Web 服务器
 */
export function stopWebServer(): void;
```

### 路由注册接口（供其他模块扩展）

```typescript
// src/web/routes.ts

/** 路由处理器类型 */
export type RouteHandler = (req: Request) => Response | Promise<Response>;

/** 注册路由 */
export function registerRoute(path: string, handler: RouteHandler): void;

/** 移除路由 */
export function unregisterRoute(path: string): void;
```

---

## 路由设计（第一阶段）

### 基础路由

```
GET /health          → 健康检查
GET /                → 首页（框架介绍）
```

### Health Check 响应格式

```typescript
interface HealthResponse {
  status: "ok";
  service: "ys-code";
  version: string;        // package.json version
  pid: number;
  timestamp: number;
  uptime: number;         // 进程运行时间（秒）
}
```

---

## CLI 集成设计

### 参数设计

```bash
# 启动 TUI，同时启动 Web Server
bun run tui --web
bun run tui --web --port 8080

# 仅启动 Web Server（不启动 TUI）
bun run tui --web-only
bun run tui --web-only --port 8080
```

### 集成点

修改 CLI 入口（假设为 `src/cli/main.ts` 或 `src/index.ts`）：

```typescript
import { Command } from "commander";
import { createWebServer, stopWebServer } from "../web";
import { startTUI } from "../tui";

const program = new Command();

program
  .option("--web", "启动时同时开启 Web 预览")
  .option("--web-only", "仅启动 Web Server，不启动 TUI")
  .option("--port <number>", "指定 Web Server 端口", "0")
  .action(async (options) => {
    let webServer: WebServer | undefined;

    // 启动 Web Server（如果需要）
    if (options.web || options.webOnly) {
      webServer = createWebServer({
        port: parseInt(options.port, 10),
        hostname: "127.0.0.1",
      });
      
      console.log(`Web server running at ${webServer.url}`);
    }

    // 启动 TUI（如果需要）
    if (!options.webOnly) {
      await startTUI();
    } else {
      // web-only 模式下保持进程运行
      process.stdin.resume();
    }

    // 清理
    process.on("SIGINT", () => {
      webServer?.stop();
      process.exit(0);
    });
  });

program.parse();
```

### 端口分配策略

| 场景 | 端口 | 说明 |
|------|------|------|
| `bun run tui --web` | 自动分配 | `port: 0`，启动后打印 URL |
| `bun run tui --web --port 8080` | 8080 | 用户指定，冲突时报错 |
| 多个 terminal | 各自自动分配 | 不冲突，每个进程独立 |

---

## 安全设计

| 措施 | 实现 |
|------|------|
| 仅本地访问 | `hostname: "127.0.0.1"` |
| 默认关闭 | `--web` 是显式开关 |
| 无敏感信息泄露 | Health check 不包含路径/密钥 |

---

## 实现计划（第一阶段）

### Task 1: Web 模块骨架
- 创建 `src/web/` 目录结构
- 实现 `server.ts`：Bun.serve() 封装
- 实现 `types.ts`：类型定义

### Task 2: 路由系统
- 实现 `routes.ts`：路由注册中心
- 实现 `GET /health` 路由

### Task 3: 首页页面
- 创建 `pages/home.html.ts`：内嵌 HTML 字符串
- 实现 `GET /` 路由返回首页

### Task 4: CLI 集成
- 修改 CLI 入口，添加 `--web` / `--web-only` / `--port` 参数
- 集成 `createWebServer()` 启动逻辑

### Task 5: 端到端验证
- 启动 `bun run tui --web-only`
- 验证 health check 和首页可访问
- 验证 TUI + Web 同进程运行稳定

---

## 后续扩展（非第一阶段）

- **Session Viewer**：在框架上添加 `/sessions` 路由和页面
- **WebSocket**：实时推送 TUI 状态变更
- **API 扩展**：暴露更多内部状态（如当前任务、token 用量）
- **Plugin 路由**：允许其他模块注册自定义路由

---

## Spec 自审

1. **Placeholder scan**：无 TBD/TODO
2. **内部一致性**：接口设计与现有代码风格一致
3. **Scope check**：聚焦框架本身，不涉及具体业务功能
4. **Ambiguity check**：端口行为、启动方式已明确
