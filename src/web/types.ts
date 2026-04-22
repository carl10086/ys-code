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
