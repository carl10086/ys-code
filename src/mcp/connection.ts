import type { McpConfig, McpServerConfig } from "./types.js";
import type { McpServerConnection } from "./transport.js";
import { createMcpServerConnection } from "./transport.js";
import { McpConnectionError } from "./errors.js";

function getConnectTimeoutMs(): number {
  const env = process.env.MCP_TIMEOUT;
  if (env) {
    const parsed = Number(env);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 30_000;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  context: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new McpConnectionError(`${context} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

export class McpConnectionManager {
  private connections = new Map<string, McpServerConnection>();
  private failures = new Map<string, Error>();

  async connectAll(
    config: McpConfig,
    factory?: (name: string, serverConfig: McpServerConfig) => McpServerConnection,
  ): Promise<void> {
    this.connections.clear();
    this.failures.clear();

    const entries = Object.entries(config.mcpServers);

    await Promise.all(
      entries.map(async ([name, serverConfig]) => {
        let connection: McpServerConnection | undefined;
        try {
          connection = factory
            ? factory(name, serverConfig)
            : createMcpServerConnection(name, serverConfig);
          await withTimeout(
            connection.connect(),
            getConnectTimeoutMs(),
            `connect to "${name}"`,
          );
          this.connections.set(name, connection);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.failures.set(name, err);
          await connection?.disconnect().catch(() => {});
        }
      }),
    );
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.connections.values()).map(async (connection) => {
        try {
          await connection.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }),
    );
    this.connections.clear();
  }

  getConnections(): Map<string, McpServerConnection> {
    return new Map(this.connections);
  }

  getFailures(): Map<string, Error> {
    return new Map(this.failures);
  }
}
