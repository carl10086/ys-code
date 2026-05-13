import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpConfig, McpServerConfig } from "./types.js";
import { McpConfigError } from "./errors.js";

export async function loadMcpConfig(cwd: string): Promise<McpConfig> {
  const configPath = join(cwd, ".mcp.json");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);

    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      return { mcpServers: {} };
    }

    const mcpServers: Record<string, McpServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(parsed.mcpServers)) {
      const config = normalizeServerConfig(
        name,
        serverConfig as Record<string, unknown>,
      );
      mcpServers[name] = config;
    }

    return { mcpServers };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw error;
  }
}

function normalizeServerConfig(
  name: string,
  raw: Record<string, unknown>,
): McpServerConfig {
  const hasCommand = typeof raw.command === "string";
  const hasUrl = typeof raw.url === "string";

  if (!hasCommand && !hasUrl) {
    throw new McpConfigError(
      `Server "${name}" must have either "command" (stdio) or "url" (http)`,
    );
  }

  if (hasCommand && hasUrl) {
    throw new McpConfigError(
      `Server "${name}" cannot have both "command" and "url"`,
    );
  }

  const config: McpServerConfig = {};

  if (hasCommand) {
    config.command = raw.command as string;
    if (Array.isArray(raw.args)) {
      config.args = raw.args.map(String);
    }
  }

  if (hasUrl) {
    config.url = raw.url as string;
  }

  if (typeof raw.transport === "string") {
    if (raw.transport !== "stdio" && raw.transport !== "http") {
      throw new McpConfigError(
        `Server "${name}" has invalid transport "${raw.transport}", must be "stdio" or "http"`,
      );
    }
    config.transport = raw.transport;
  } else {
    config.transport = hasCommand ? "stdio" : "http";
  }

  if (raw.env && typeof raw.env === "object") {
    config.env = expandEnvVars(raw.env as Record<string, string>);
  }

  return config;
}

function expandEnvVars(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(
      /\$\{([^}]+)\}/g,
      (_, varName) => process.env[varName] ?? "",
    );
  }
  return result;
}
