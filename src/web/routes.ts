// src/web/routes.ts
import type { RouteHandler } from "./types.js";
import { HOME_HTML } from "./pages/home.html.js";
import { handleSessionAPI, getSessionDir } from "./session-api.js";
import { SESSIONS_HTML } from "./pages/sessions.html.js";

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
        sessionDir: getSessionDir(),
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

  return (request: Request): Response | Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 优先精确匹配
    const exactHandler = routes.get(pathname);
    if (exactHandler) {
      return exactHandler(request);
    }

    // 其次前缀匹配（用于 /api/sessions/:filename）
    for (const [routePath, handler] of routes) {
      if (pathname.startsWith(routePath + "/")) {
        return handler(request);
      }
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}
