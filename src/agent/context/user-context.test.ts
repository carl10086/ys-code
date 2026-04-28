import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getUserContext,
  clearUserContextCache,
  prependUserContext,
} from "./user-context.js";
import { clearMemoryFilesCache } from "../../utils/claudemd.js";

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

  it("getUserContext 应读取 CLAUDE.md", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Rule");
    const ctx = await getUserContext({ cwd: tempDir });
    expect(ctx.claudeMd).toBeDefined();
    expect(ctx.claudeMd).toContain("# Rule");
  });

  describe("prependUserContext", () => {
    it("空 context 应返回原 messages", () => {
      const messages = [{ role: "user" as const, content: "hello", timestamp: Date.now() }];
      const result = prependUserContext(messages, {});
      expect(result).toBe(messages);
    });

    it("非空 context 应生成 isMeta: true 的 user message 并 prepend", () => {
      const messages = [{ role: "user" as const, content: "hello", timestamp: Date.now() }];
      const result = prependUserContext(messages, {
        currentDate: "2026/04/19",
      });

      expect(result.length).toBe(2);
      expect(result[0].role).toBe("user");
      expect((result[0] as any).isMeta).toBe(true);
      expect((result[0] as any).content).toContain("<system-reminder>");
      expect((result[0] as any).content).toContain("2026/04/19");
      expect(result[1]).toBe(messages[0]);
    });

    it("应包含所有 context 字段", () => {
      const context = {
        claudeMd: "# Rules",
        currentDate: "2026/04/19",
      };

      const result = prependUserContext([], context);

      expect(result.length).toBe(1);
      const meta = result[0] as any;
      expect(meta.content).toContain("# claudeMd\n# Rules");
      expect(meta.content).toContain("# currentDate\n2026/04/19");
      expect(meta.isMeta).toBe(true);
    });
  });
});
