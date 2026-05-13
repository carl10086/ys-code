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
