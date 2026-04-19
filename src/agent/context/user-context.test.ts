import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getUserContext,
  prependUserContext,
  clearUserContextCache,
  getUserContextAttachments,
} from "./user-context.js";
import { clearMemoryFilesCache } from "../../utils/claudemd.js";
import type { Message } from "../../core/ai/types.js";
import { normalizeMessages } from "../attachments/normalize.js";

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

  describe("getUserContextAttachments", () => {
    it("空 context 应返回空数组", () => {
      const result = getUserContextAttachments({});
      expect(result).toEqual([]);
    });

    it("非空 context 应生成 AttachmentMessage", () => {
      const result = getUserContextAttachments({
        currentDate: "2026/04/19",
      });
      expect(result.length).toBe(1);
      expect(result[0].role).toBe("attachment");
      expect(result[0].attachment.type).toBe("relevant_memories");
      expect(result[0].attachment.entries).toEqual([
        { key: "currentDate", value: "2026/04/19" },
      ]);
    });

    it("getUserContextAttachments + normalizeMessages 应与 prependUserContext 输出一致", () => {
      const context = {
        claudeMd: "# Rules",
        currentDate: "2026/04/19",
      };

      // 旧方式
      const oldResult = prependUserContext([], context);

      // 新方式
      const attachments = getUserContextAttachments(context);
      const newResult = normalizeMessages(attachments as any);

      expect(newResult.length).toBe(oldResult.length);
      expect((newResult[0] as any).content).toBe((oldResult[0] as any).content);
    });
  });
});
