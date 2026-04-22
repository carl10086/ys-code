import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getUserContext,
  clearUserContextCache,
  getUserContextAttachments,
} from "./user-context.js";
import { clearMemoryFilesCache } from "../../utils/claudemd.js";
import type { RelevantMemoriesAttachment } from "../attachments/types.js";
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
      const att = result[0].attachment as RelevantMemoriesAttachment;
      expect(att.entries).toEqual([
        { key: "currentDate", value: "2026/04/19" },
      ]);
    });

    it("getUserContextAttachments + normalizeMessages 应与旧方式输出一致", () => {
      const context = {
        claudeMd: "# Rules",
        currentDate: "2026/04/19",
      };

      // 新方式
      const attachments = getUserContextAttachments(context);
      const newResult = normalizeMessages(attachments);

      expect(newResult.length).toBe(1);
      expect((newResult[0] as any).content).toContain("# Rules");
      expect((newResult[0] as any).content).toContain("2026/04/19");
    });
  });
});
