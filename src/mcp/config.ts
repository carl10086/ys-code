import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpConfig, McpServerConfig } from "./types.js";
import { McpConfigError } from "./errors.js";
import { logger } from "../utils/logger.js";

export async function loadMcpConfig(cwd: string): Promise<McpConfig> {
  const configPath = join(cwd, ".mcp.json");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);

    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      return { mcpServers: {} };
    }

    const mcpServers: Record<string, McpServerConfig> = {};
    const allMissingVars: Record<string, string[]> = {};

    for (const [name, serverConfig] of Object.entries(parsed.mcpServers)) {
      const { config, missingVars } = normalizeServerConfig(
        name,
        serverConfig as Record<string, unknown>,
      );
      mcpServers[name] = config;
      if (missingVars.length > 0) {
        allMissingVars[name] = missingVars;
      }
    }

    for (const [name, vars] of Object.entries(allMissingVars)) {
      logger.warn(
        `MCP server "${name}" config references missing environment variables`,
        { vars },
      );
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
): { config: McpServerConfig; missingVars: string[] } {
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
  let missingVars: string[] = [];

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
    const expanded = expandEnvVars(raw.env as Record<string, string>);
    config.env = expanded.env;
    missingVars = expanded.missingVars;
  }

  return { config, missingVars };
}

function expandEnvVars(env: Record<string, string>): {
  env: Record<string, string>;
  missingVars: string[];
} {
  const result: Record<string, string> = {};
  const missingVars: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    const strValue = typeof value === "string" ? value : String(value);
    result[key] = strValue.replace(
      /\$\{([^}]+)\}/g,
      (_, varExpr: string) => {
        const [varName, defaultValue] = varExpr.split(":-", 2);
        const envValue = process.env[varName];
        if (envValue === undefined) {
          if (defaultValue !== undefined) {
            return defaultValue;
          }
          if (!missingVars.includes(varName)) {
            missingVars.push(varName);
          }
          return "";
        }
        return envValue;
      },
    );
  }

  return { env: result, missingVars };
}
