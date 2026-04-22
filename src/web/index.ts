// src/web/index.ts
export type { WebServerConfig, WebServer, RouteHandler } from "./types.js";
export { createWebServer, stopWebServer } from "./server.js";
export { registerRoute, buildRouter } from "./routes.js";
