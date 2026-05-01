import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FileStateCache } from "../../agent/file-state.js";
import {
  createBackgroundTaskRestoreAttachments,
  createPlanRestoreAttachments,
  createPostCompactFileAttachments,
  createSkillRestoreAttachments,
} from "./attachments.js";

describe("compact attachments", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("FileStateCache snapshots read records", () => {
    const cache = new FileStateCache();
    cache.recordRead("/tmp/a.ts", "a", 1000);

    expect(cache.snapshot()).toEqual([
      {
        path: "/tmp/a.ts",
        record: {
          content: "a",
          timestamp: 1000,
          offset: undefined,
          limit: undefined,
          isPartialView: false,
        },
      },
    ]);
  });

  it("restores recently read files by rereading current file content", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const filePath = join(tempDir, "file.ts");
    writeFileSync(filePath, "old content");

    const cache = new FileStateCache();
    cache.recordRead(filePath, "old content", 1000);
    writeFileSync(filePath, "new content");

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0].role).toBe("attachment");
    expect(attachments[0].attachment.type).toBe("file");
    if (attachments[0].attachment.type !== "file") {
      throw new Error("Expected file attachment");
    }
    expect(attachments[0].attachment.content.file?.content).toBe("new content");
  });

  it("skips missing files and files over the byte budget", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const largeFile = join(tempDir, "large.txt");
    writeFileSync(largeFile, "x".repeat(20));

    const cache = new FileStateCache();
    cache.recordRead(join(tempDir, "missing.txt"), "missing", 1000);
    cache.recordRead(largeFile, "large", 1001);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxBytesPerFile: 10,
      maxFiles: 5,
    });

    expect(attachments).toEqual([]);
  });

  it("provides empty extension points for future restore sources", async () => {
    await expect(createSkillRestoreAttachments()).resolves.toEqual([]);
    await expect(createPlanRestoreAttachments()).resolves.toEqual([]);
    await expect(createBackgroundTaskRestoreAttachments()).resolves.toEqual([]);
  });
});
