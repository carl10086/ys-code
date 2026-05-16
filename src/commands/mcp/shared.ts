import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpConfig } from "../../mcp/types.js";

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

export function validateServerName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new Error(
      `Invalid server name "${name}". Must match ${VALID_NAME.source}`,
    );
  }
}

export async function loadMcpJson(cwd: string): Promise<McpConfig> {
  const { loadMcpConfig } = await import("../../mcp/config.js");
  return loadMcpConfig(cwd);
}

export async function writeMcpJson(
  cwd: string,
  config: McpConfig,
): Promise<void> {
  const configPath = join(cwd, ".mcp.json");
  const tmpPath = join(tmpdir(), `.mcp.json.tmp.${Date.now()}`);
  await writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await rename(tmpPath, configPath);
}
