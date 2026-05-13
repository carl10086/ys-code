import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./types.js";
import { McpConnectionError } from "./errors.js";

export interface McpServerConnection {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getCapabilities(): unknown;
  listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  >;
  callTool(name: string, args: unknown): Promise<unknown>;
  listResources(): Promise<Array<{ uri: string; name?: string }>>;
  readResource(uri: string): Promise<unknown>;
  listPrompts(): Promise<Array<{ name: string; description?: string }>>;
  getPrompt(name: string, args?: unknown): Promise<unknown>;
}

export function createMcpServerConnection(
  name: string,
  config: McpServerConfig,
): McpServerConnection {
  if (config.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: config.command!,
      args: config.args,
      env: config.env,
    });
    return new BaseMcpServerConnection(name, transport);
  }

  if (config.transport === "http") {
    const transport = new StreamableHTTPClientTransport(
      new URL(config.url!),
    );
    return new BaseMcpServerConnection(name, transport);
  }

  throw new McpConnectionError(
    `Transport "${config.transport}" not yet implemented`,
  );
}

class BaseMcpServerConnection implements McpServerConnection {
  private client: Client;
  private _isConnected = false;

  constructor(
    public readonly name: string,
    private transport: Transport,
  ) {
    this.client = new Client(
      { name: "ys-code", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this._isConnected = true;
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    this._isConnected = false;
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  getCapabilities(): unknown {
    return this.client.getServerCapabilities();
  }

  async listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  > {
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.client.callTool({
      name,
      arguments: args as Record<string, string>,
    });
    return result;
  }

  async listResources(): Promise<Array<{ uri: string; name?: string }>> {
    const result = await this.client.listResources();
    return result.resources;
  }

  async readResource(uri: string): Promise<unknown> {
    const result = await this.client.readResource({ uri });
    return result;
  }

  async listPrompts(): Promise<Array<{ name: string; description?: string }>> {
    const result = await this.client.listPrompts();
    return result.prompts;
  }

  async getPrompt(name: string, args?: unknown): Promise<unknown> {
    const result = await this.client.getPrompt({
      name,
      arguments: args as Record<string, string> | undefined,
    });
    return result;
  }
}
