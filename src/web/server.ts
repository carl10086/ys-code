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

  const actualPort = bunServer.port ?? 0;

  const server: WebServer = {
    port: actualPort,
    url: `http://${hostname}:${actualPort}`,
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
