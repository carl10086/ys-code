import type { McpServerConnection } from "./transport.js";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "stdio" | "http";
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export type McpServerState =
  | { kind: "pending"; name: string; config: McpServerConfig }
  | {
      kind: "connected";
      name: string;
      config: McpServerConfig;
      connection: McpServerConnection;
    }
  | {
      kind: "failed";
      name: string;
      config: McpServerConfig;
      error: Error;
      attempts: number;
    }
  | {
      kind: "needs-auth";
      name: string;
      config: McpServerConfig;
      reason: string;
    };

export const MAX_RECONNECT_ATTEMPTS = 5;
export const INITIAL_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30000;
