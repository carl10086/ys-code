# Web 框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ys-code 中建立可嵌入的 HTTP Server 技术框架，支持通过 `--web` 参数在启动 TUI 时同时暴露 Web 能力。

**Architecture:** 单进程双模式 — Ink TUI 与 Bun.serve() 共存于同一个进程。Web 模块封装在 `src/web/` 包中，对外暴露 `createWebServer()` / `stopWebServer()` / `registerRoute()` 接口。前端资源内嵌在 TypeScript 源码中。

**Tech Stack:** Bun (内置 HTTP server) + `@commander-js/extra-typings` (CLI 参数解析)

---

## 文件结构

```
src/
├── main.ts                    # CLI 统一入口（新增）
├── web/                       # Web 框架模块（新增目录）
│   ├── index.ts               # 模块入口
│   ├── types.ts               # WebServerConfig / WebServer / RouteHandler
│   ├── server.ts              # Bun.serve() 封装
│   ├── routes.ts              # 路由注册中心
│   └── pages/                 # 内嵌页面资源
│       └── home.html.ts       # 极简首页
├── tui/
│   └── index.tsx              # 修改：导出 startTUI()
```

---

## 决策记录

**砍掉的多余设计：**

| 原设计 | 砍掉理由 |
|--------|---------|
| `--web-only` | 无意义，单独跑 Web 不需要这个参数 |
| `--port` | `port: 0` 自动分配足够用 |
| `silent` | 直接用现有 logger，不需要静默开关 |
| `getCurrentServer()` | 无调用方，永远用不上 |
| `unregisterRoute()` / `clearRoutes()` | 没有运行时注销路由的需求 |
| `src/cli/web-options.ts` | 就一个 Commander 定义，内联到 main.ts |
| 复杂首页（暗色主题 + 动画） | 第一阶段只需验证框架能跑 |
| 首页单元测试 / 并发测试 / CLI 参数测试 | 测的是内容字符串或 Bun 本身，不是我们的逻辑 |

---

### Task 1: Web 模块骨架

**Files:**
- Create: `src/web/types.ts`
- Create: `src/web/server.ts`
- Create: `src/web/routes.ts`
- Create: `src/web/pages/home.html.ts`
- Create: `src/web/index.ts`
- Test: `src/web/server.test.ts`

- [ ] **Step 1: 编写失败的测试**

```typescript
// src/web/server.test.ts
import { describe, it, expect } from "bun:test";
import { createWebServer, stopWebServer } from "./index.js";

describe("Web Server", () => {
  it("should start server with auto-assigned port", async () => {
    const server = createWebServer();
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    server.stop();
  });

  it("should stop server gracefully", async () => {
    const server = createWebServer();
    server.stop();
    // 停止后端口应不可访问
    try {
      await fetch(server.url + "/health");
      expect(false).toBe(true);
    } catch {
      expect(true).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test src/web/server.test.ts
```

Expected: FAIL with "createWebServer is not defined"

- [ ] **Step 3: 实现类型定义**

```typescript
// src/web/types.ts

/** Web 服务器配置 */
export interface WebServerConfig {
  /** 绑定端口，0 表示自动分配 */
  port?: number;
  /** 绑定地址，默认 127.0.0.1 */
  hostname?: string;
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

/** 路由处理器类型 */
export type RouteHandler = (req: Request) => Response | Promise<Response>;
```

- [ ] **Step 4: 实现路由系统**

```typescript
// src/web/routes.ts
import type { RouteHandler } from "./types.js";
import { HOME_HTML } from "./pages/home.html.js";

/** 路由表 */
const routes = new Map<string, RouteHandler>();

/**
 * 注册路由
 * @param path 路由路径
 * @param handler 请求处理器
 */
export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

/**
 * 构建路由器
 */
export function buildRouter(): (req: Request) => Response | Promise<Response> {
  // 注册内置路由（只注册一次）
  if (!routes.has("/health")) {
    registerRoute("/health", () => {
      return Response.json({
        status: "ok",
        service: "ys-code",
        pid: process.pid,
        timestamp: Date.now(),
        uptime: Math.floor(process.uptime()),
      });
    });
  }

  if (!routes.has("/")) {
    registerRoute("/", () => {
      return new Response(HOME_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }

  return (request: Request): Response | Promise<Response> => {
    const url = new URL(request.url);
    const handler = routes.get(url.pathname);

    if (handler) {
      return handler(request);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}
```

- [ ] **Step 5: 实现服务器封装**

```typescript
// src/web/server.ts
import type { WebServerConfig, WebServer } from "./types.js";
import { buildRouter } from "./routes.js";
import { logger } from "../utils/logger.js";

let currentServer: WebServer | undefined;

/**
 * 创建并启动 Web 服务器
 * @param config 服务器配置
 * @returns WebServer 实例
 */
export function createWebServer(config?: WebServerConfig): WebServer {
  if (currentServer) {
    throw new Error("Web server already running");
  }

  const hostname = config?.hostname ?? "127.0.0.1";
  const port = config?.port ?? 0;

  const router = buildRouter();

  const bunServer = Bun.serve({
    hostname,
    port,
    fetch(request: Request): Response | Promise<Response> {
      return router(request);
    },
  });

  const server: WebServer = {
    port: bunServer.port,
    url: `http://${hostname}:${bunServer.port}`,
    stop() {
      bunServer.stop();
      currentServer = undefined;
    },
  };

  currentServer = server;
  logger.info("Web server started", { url: server.url });

  return server;
}

/**
 * 停止当前运行的 Web 服务器
 */
export function stopWebServer(): void {
  if (currentServer) {
    logger.info("Web server stopping");
    currentServer.stop();
  }
}
```

- [ ] **Step 6: 实现极简首页**

```typescript
// src/web/pages/home.html.ts

/** 极简首页 */
export const HOME_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>ys-code</title>
</head>
<body>
  <h1>ys-code web server is running</h1>
  <p>PID: <span id="pid">-</span></p>
  <script>
    fetch("/health").then(r => r.json()).then(d => {
      document.getElementById("pid").textContent = d.pid;
    });
  </script>
</body>
</html>`;
```

- [ ] **Step 7: 实现模块入口**

```typescript
// src/web/index.ts
export type { WebServerConfig, WebServer, RouteHandler } from "./types.js";
export { createWebServer, stopWebServer } from "./server.js";
export { registerRoute, buildRouter } from "./routes.js";
```

- [ ] **Step 8: 运行测试，确认通过**

```bash
bun test src/web/server.test.ts
```

Expected: PASS (2/2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/web/
git commit -m "feat(web): add web server skeleton with health check and home page"
```

---

### Task 2: CLI 集成

**Files:**
- Create: `src/main.ts`
- Modify: `src/tui/index.tsx`
- Modify: `package.json`
- Test: `src/web/e2e.test.ts`

- [ ] **Step 1: 编写端到端测试**

```typescript
// src/web/e2e.test.ts
import { describe, it, expect } from "bun:test";
import { createWebServer, stopWebServer } from "./index.js";

describe("Web Framework E2E", () => {
  it("should serve health check and home page", async () => {
    const server = createWebServer();

    try {
      // health check
      const healthRes = await fetch(`${server.url}/health`);
      expect(healthRes.status).toBe(200);
      const health = await healthRes.json();
      expect(health.status).toBe("ok");
      expect(health.pid).toBe(process.pid);

      // home page
      const homeRes = await fetch(server.url);
      expect(homeRes.status).toBe(200);
      expect(homeRes.headers.get("Content-Type")).toContain("text/html");

      // 404
      const notFoundRes = await fetch(`${server.url}/not-exist`);
      expect(notFoundRes.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test src/web/e2e.test.ts
```

Expected: FAIL with "createWebServer is not defined"（因为 CLI 还没集成，只是测试 server 本身）

实际上此时 Task 1 已完成，server 已存在，这个测试应该能直接通过。如果 Task 1 已完成：

```bash
bun test src/web/e2e.test.ts
```

Expected: PASS (1/1 test)

- [ ] **Step 3: 修改 TUI 入口，导出启动函数**

```typescript
// src/tui/index.tsx
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { logger } from "../utils/logger.js";

export async function startTUI(): Promise<void> {
  try {
    const instance = await render(<App />);
    logger.info("TUI started");
    process.on("SIGINT", async () => {
      logger.info("TUI exiting (SIGINT)");
      await instance.waitUntilExit();
      process.exit(0);
    });
  } catch (err) {
    logger.error("Failed to start TUI", { error: String(err) });
    process.exit(1);
  }
}

// 保持直接运行能力
if (import.meta.main) {
  startTUI();
}
```

- [ ] **Step 4: 创建 CLI 统一入口**

```typescript
// src/main.ts
import { Command } from "@commander-js/extra-typings";
import { createWebServer, stopWebServer } from "./web/index.js";
import { startTUI } from "./tui/index.js";
import { logger } from "./utils/logger.js";

const program = new Command()
  .name("ys-code")
  .description("ys-code - AI-powered coding assistant")
  .option("--web", "启动时同时开启 Web 预览");

async function main() {
  program.parse();
  const options = program.opts();

  let webServer: ReturnType<typeof createWebServer> | undefined;

  // 启动 Web Server（如果需要）
  if (options.web) {
    try {
      webServer = createWebServer({
        port: 0,
        hostname: "127.0.0.1",
      });
      console.log(`Web server: ${webServer.url}`);
    } catch (err) {
      logger.error("Failed to start web server", { error: String(err) });
      process.exit(1);
    }
  }

  // 启动 TUI
  await startTUI();

  // 清理
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    webServer?.stop();
    stopWebServer();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error("Unhandled error", { error: String(err) });
  process.exit(1);
});
```

- [ ] **Step 5: 修改 package.json**

```json
{
  "scripts": {
    "dev": "bun run src/main.ts",
    "dev:web": "bun run src/main.ts --web",
    "tui": "bun run src/tui/index.tsx",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 6: 运行全部测试**

```bash
bun test
```

Expected: 所有现有测试通过 + 新增测试通过

- [ ] **Step 7: 手动验证 CLI 启动**

```bash
bun run src/main.ts --web
```

Expected 输出：
```
Web server: http://127.0.0.1:xxxxx
[TUI 启动...]
```

另开一个终端验证：
```bash
curl -s http://127.0.0.1:xxxxx/health | jq .
```

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/tui/index.tsx package.json src/web/e2e.test.ts
git commit -m "feat(cli): add --web flag to start web server alongside TUI"
```

---

## Spec 覆盖检查

| 设计文档要求 | 实现任务 | 状态 |
|-------------|---------|------|
| `src/web/` 模块 | Task 1 | ✅ |
| 路由系统 + 动态注册 | Task 1 | ✅ |
| Health Check 端点 | Task 1 | ✅ |
| 极简首页 | Task 1 | ✅ |
| `--web` CLI 参数 | Task 2 | ✅ |
| `src/main.ts` CLI 统一入口 | Task 2 | ✅ |
| 端到端验证 | Task 2 | ✅ |
| 仅本地访问（127.0.0.1） | Task 1（server.ts） | ✅ |
| 自动端口分配（port: 0） | Task 1 / Task 2 | ✅ |
| 复用 logger | Task 1（server.ts） | ✅ |

---

## Placeholder 检查

- [x] 无 "TBD" / "TODO" / "implement later"
- [x] 所有步骤包含可执行命令
- [x] 无未定义的类型/函数引用

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-04-23-web-framework-plan.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?"
