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
