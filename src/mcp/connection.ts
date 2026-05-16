import type { McpConfig, McpServerConfig, McpServerState } from "./types.js";
import {
  MAX_RECONNECT_ATTEMPTS,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from "./types.js";
import type { McpServerConnection } from "./transport.js";
import { createMcpServerConnection } from "./transport.js";
import { McpConnectionError } from "./errors.js";
import { logger } from "../utils/logger.js";

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

export function calculateBackoffDelay(attempts: number): number {
  const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempts);
  return Math.min(delay, MAX_BACKOFF_MS);
}

function isAuthError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication") ||
    msg.includes("auth")
  );
}

export class McpConnectionManager {
  private states = new Map<string, McpServerState>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private factory?: (name: string, serverConfig: McpServerConfig) => McpServerConnection;

  async connectAll(
    config: McpConfig,
    factory?: (name: string, serverConfig: McpServerConfig) => McpServerConnection,
  ): Promise<void> {
    this.states.clear();
    this.clearAllReconnectTimers();
    this.factory = factory;

    const entries = Object.entries(config.mcpServers);

    await Promise.all(
      entries.map(async ([name, serverConfig]) => {
        this.states.set(name, {
          kind: "pending",
          name,
          config: serverConfig,
        });

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

          this.states.set(name, {
            kind: "connected",
            name,
            config: serverConfig,
            connection,
          });

          // Attach onClose handler for reconnect logic
          connection.onClose = () => {
            this.handleConnectionClose(name, serverConfig);
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          await connection?.disconnect().catch(() => {});

          this.states.set(name, {
            kind: "failed",
            name,
            config: serverConfig,
            error: err,
            attempts: 1,
          });
        }
      }),
    );
  }

  private handleConnectionClose(
    name: string,
    config: McpServerConfig,
  ): void {
    const currentState = this.states.get(name);
    if (!currentState || currentState.kind !== "connected") return;

    if (config.transport === "http") {
      // HTTP: transition to pending and schedule reconnect
      // Each disconnect-reconnect cycle starts fresh at attempt 0
      this.states.set(name, {
        kind: "pending",
        name,
        config,
      });
      this.scheduleReconnect(name, config, 0);
    } else {
      // stdio: directly to failed (no reconnect)
      this.states.set(name, {
        kind: "failed",
        name,
        config,
        error: new Error("Transport closed unexpectedly"),
        attempts: 1,
      });
    }
  }

  private scheduleReconnect(
    name: string,
    config: McpServerConfig,
    attempts: number,
  ): void {
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.states.set(name, {
        kind: "failed",
        name,
        config,
        error: new Error(
          `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded`,
        ),
        attempts,
      });
      return;
    }

    const delay = calculateBackoffDelay(attempts);
    logger.info(`Scheduling MCP server "${name}" reconnect in ${delay}ms`, {
      attempts,
      delay,
    });

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(name);
      this.performReconnect(name, config, attempts);
    }, delay);

    this.reconnectTimers.set(name, timer);
  }

  private async performReconnect(
    name: string,
    config: McpServerConfig,
    attempts: number,
  ): Promise<void> {
    const currentState = this.states.get(name);
    if (!currentState || currentState.kind !== "pending") return;

    let connection: McpServerConnection | undefined;
    try {
      connection = this.factory
        ? this.factory(name, config)
        : createMcpServerConnection(name, config);
      await withTimeout(
        connection.connect(),
        getConnectTimeoutMs(),
        `reconnect to "${name}"`,
      );

      this.states.set(name, {
        kind: "connected",
        name,
        config,
        connection,
      });

      connection.onClose = () => {
        this.handleConnectionClose(name, config);
      };

      logger.info(`MCP server "${name}" reconnected successfully`, {
        attempts: attempts + 1,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await connection?.disconnect().catch(() => {});

      if (isAuthError(err)) {
        this.states.set(name, {
          kind: "needs-auth",
          name,
          config,
          reason: err.message,
        });
        logger.warn(`MCP server "${name}" needs authentication`, {
          error: err.message,
        });
      } else {
        this.scheduleReconnect(name, config, attempts + 1);
      }
    }
  }

  async reconnect(name: string): Promise<void> {
    const state = this.states.get(name);
    if (!state) {
      throw new Error(`MCP server "${name}" not found`);
    }
    if (state.kind === "connected") {
      return;
    }
    if (state.kind === "failed" || state.kind === "needs-auth") {
      // Reset to pending and try immediately
      this.states.set(name, {
        kind: "pending",
        name,
        config: state.config,
      });
      await this.performReconnect(name, state.config, 0);
    }
  }

  async disconnectAll(): Promise<void> {
    this.clearAllReconnectTimers();

    const connectedStates = Array.from(this.states.values()).filter(
      (s): s is McpServerState & { kind: "connected" } => s.kind === "connected",
    );

    await Promise.all(
      connectedStates.map(async (state) => {
        try {
          await state.connection.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }),
    );

    this.states.clear();
  }

  private clearAllReconnectTimers(): void {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
  }

  getConnections(): Map<string, McpServerConnection> {
    const result = new Map<string, McpServerConnection>();
    for (const [name, state] of this.states) {
      if (state.kind === "connected") {
        result.set(name, state.connection);
      }
    }
    return result;
  }

  getFailures(): Map<string, Error> {
    const result = new Map<string, Error>();
    for (const [name, state] of this.states) {
      if (state.kind === "failed") {
        result.set(name, state.error);
      }
    }
    return result;
  }

  getStates(): Map<string, McpServerState> {
    return new Map(this.states);
  }
}
