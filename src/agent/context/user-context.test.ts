import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getUserContext, prependUserContext, clearUserContextCache } from "./user-context.js";
import { clearMemoryFilesCache } from "../../utils/claudemd.js";
import type { Message } from "../../core/ai/types.js";

describe("user-context", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "uc-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    clearUserContextCache();
    clearMemoryFilesCache();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prependUserContext 应在 messages 前插入 meta 消息", () => {
    const messages: Message[] = [{ role: "user", content: "hi", timestamp: 1 }];
    const result = prependUserContext(messages, { currentDate: "2026/04/17" });
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect(typeof (result[0] as any).content).toBe("string");
    expect((result[0] as any).content).toContain("<system-reminder>");
    expect((result[0] as any).content).toContain("2026/04/17");
  });

  it("getUserContext 应读取 CLAUDE.md", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Rule");
    const ctx = await getUserContext({ cwd: tempDir });
    expect(ctx.claudeMd).toBeDefined();
    expect(ctx.claudeMd).toContain("# Rule");
  });
});
