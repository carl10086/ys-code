import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FileStateCache } from "../../agent/file-state.js";
import type { InvokedSkillRecord } from "../../agent/types.js";
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

  it("restores recently read files from cached read content", async () => {
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
    expect(attachments[0].attachment.content.file?.content).toBe("old content");
  });

  it("skips missing files and files over the byte budget", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const largeFile = join(tempDir, "large.txt");
    writeFileSync(largeFile, "x".repeat(20));

    const cache = new FileStateCache();
    cache.recordRead(join(tempDir, "missing.txt"), "missing", 1000);
    cache.recordRead(largeFile, "x".repeat(20), 1001);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxBytesPerFile: 10,
      maxFiles: 5,
    });

    expect(attachments).toEqual([]);
  });

  it("uses a default byte budget before rereading file attachments", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const largeFile = join(tempDir, "large.txt");
    writeFileSync(largeFile, "x".repeat(250_000));

    const cache = new FileStateCache();
    cache.recordRead(largeFile, "x".repeat(250_000), 1000);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
    });

    expect(attachments).toEqual([]);
  });

  it("skips partial reads instead of expanding their original scope", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const filePath = join(tempDir, "file.ts");
    writeFileSync(filePath, "line 1\nline 2\nline 3");

    const cache = new FileStateCache();
    cache.recordRead(filePath, "line 2", 1000, 2, 1);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
    });

    expect(attachments).toEqual([]);
  });

  it("enforces a total byte budget across restored attachments", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const firstFile = join(tempDir, "a.txt");
    const secondFile = join(tempDir, "b.txt");
    writeFileSync(firstFile, "12345");
    writeFileSync(secondFile, "67890");

    const cache = new FileStateCache();
    cache.recordRead(firstFile, "12345", 1000);
    cache.recordRead(secondFile, "67890", 1001);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
      maxTotalBytes: 5,
    });

    expect(attachments).toHaveLength(1);
  });

  it("does not let skipped candidates consume the restored maxFiles budget", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const partialFile = join(tempDir, "partial.txt");
    const fullFile = join(tempDir, "full.txt");
    writeFileSync(partialFile, "partial");
    writeFileSync(fullFile, "full");

    const cache = new FileStateCache();
    cache.recordRead(partialFile, "partial", 1000, 1, 1);
    cache.recordRead(fullFile, "full", 1001);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 1,
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0].attachment.type).toBe("file");
    if (attachments[0].attachment.type !== "file") {
      throw new Error("Expected file attachment");
    }
    expect(attachments[0].attachment.filePath).toBe(fullFile);
  });

  it("skips cached files outside cwd and sensitive file paths", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "compact-outside-"));
    const outsideFile = join(outsideDir, "outside.txt");
    const envFile = join(tempDir, ".env");
    const normalFile = join(tempDir, "normal.txt");
    writeFileSync(outsideFile, "outside");
    writeFileSync(envFile, "TOKEN=secret");
    writeFileSync(normalFile, "normal");

    const cache = new FileStateCache();
    cache.recordRead(outsideFile, "outside", 1000);
    cache.recordRead(envFile, "TOKEN=secret", 1001);
    cache.recordRead(normalFile, "normal", 1002);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0].attachment.type).toBe("file");
    if (attachments[0].attachment.type !== "file") {
      throw new Error("Expected file attachment");
    }
    expect(attachments[0].attachment.filePath).toBe(normalFile);

    rmSync(outsideDir, { recursive: true, force: true });
  });

  it("skips common sensitive file names and directories", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const sensitivePaths = [
      ".envrc",
      ".env.local",
      ".env.production",
      ".npmrc",
      ".netrc",
      ".pypirc",
      "client.pem",
      "service.key",
      "credentials.json",
      join(".aws", "config"),
      join(".kube", "config"),
      join(".ssh", "id_rsa"),
      join(".ssh", "known_hosts"),
    ];
    const cache = new FileStateCache();

    for (const relativePath of sensitivePaths) {
      const filePath = join(tempDir, relativePath);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, "secret");
      cache.recordRead(filePath, "secret", 1000);
    }

    const normalFile = join(tempDir, "normal.txt");
    writeFileSync(normalFile, "normal");
    cache.recordRead(normalFile, "normal", 1001);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 20,
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0].attachment.type).toBe("file");
    if (attachments[0].attachment.type !== "file") {
      throw new Error("Expected file attachment");
    }
    expect(attachments[0].attachment.filePath).toBe(normalFile);
  });

  it("skips cwd symlinks that resolve outside the workspace", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "compact-outside-"));
    const outsideFile = join(outsideDir, "outside.txt");
    const symlinkPath = join(tempDir, "linked.txt");
    writeFileSync(outsideFile, "outside secret");
    symlinkSync(outsideFile, symlinkPath);

    const cache = new FileStateCache();
    cache.recordRead(symlinkPath, "outside secret", 1000);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
    });

    expect(attachments).toEqual([]);

    rmSync(outsideDir, { recursive: true, force: true });
  });

  it("skips cached files whose content appears to contain secrets", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "compact-attachments-"));
    const tokenFile = join(tempDir, "config.json");
    const normalFile = join(tempDir, "normal.txt");
    writeFileSync(tokenFile, '{"token":"ghp_abcdefghijklmnopqrstuvwxyz1234567890"}');
    writeFileSync(normalFile, "normal");

    const cache = new FileStateCache();
    cache.recordRead(tokenFile, '{"token":"ghp_abcdefghijklmnopqrstuvwxyz1234567890"}', 1000);
    cache.recordRead(normalFile, "normal", 1001);

    const attachments = await createPostCompactFileAttachments(cache, {
      cwd: tempDir,
      maxFiles: 5,
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0].attachment.type).toBe("file");
    if (attachments[0].attachment.type !== "file") {
      throw new Error("Expected file attachment");
    }
    expect(attachments[0].attachment.filePath).toBe(normalFile);
  });

  it("restores invoked skills sorted by latest invocation", async () => {
    const invokedSkills = new Map<string, InvokedSkillRecord>([
      ["older", { name: "older", path: "/skills/older/SKILL.md", content: "older content", invokedAt: 1000 }],
      ["newer", { name: "newer", path: "/skills/newer/SKILL.md", content: "newer content", invokedAt: 2000 }],
    ]);

    const result = await createSkillRestoreAttachments(invokedSkills);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].attachment.type).toBe("invoked_skills");
    if (result.attachments[0].attachment.type !== "invoked_skills") {
      throw new Error("Expected invoked_skills attachment");
    }
    expect(result.attachments[0].attachment.skills.map((skill) => skill.name)).toEqual(["newer", "older"]);
    expect(result.diagnostics.generated).toEqual([
      { type: "invoked_skills", count: 2 },
    ]);
    expect(result.diagnostics.skipped).toEqual([]);
  });

  it("truncates invoked skill content over the per-skill byte budget", async () => {
    const invokedSkills = new Map<string, InvokedSkillRecord>([
      ["large", { name: "large", path: "/skills/large/SKILL.md", content: "abcdef", invokedAt: 1000 }],
    ]);

    const result = await createSkillRestoreAttachments(invokedSkills, {
      maxBytesPerSkill: 3,
      maxTotalBytes: 100,
    });

    expect(result.attachments[0].attachment.type).toBe("invoked_skills");
    if (result.attachments[0].attachment.type !== "invoked_skills") {
      throw new Error("Expected invoked_skills attachment");
    }
    expect(result.attachments[0].attachment.skills[0].content).toContain("abc");
    expect(result.attachments[0].attachment.skills[0].content).toContain("[... skill content truncated for compaction]");
  });

  it("skips invoked skills that exceed the total restore budget", async () => {
    const invokedSkills = new Map<string, InvokedSkillRecord>([
      ["too-large", { name: "too-large", path: "/skills/too-large/SKILL.md", content: "abcdef", invokedAt: 1000 }],
    ]);

    const result = await createSkillRestoreAttachments(invokedSkills, {
      maxBytesPerSkill: 100,
      maxTotalBytes: 3,
    });

    expect(result.attachments).toEqual([]);
    expect(result.diagnostics.skipped).toEqual([
      {
        type: "invoked_skills",
        displayName: "too-large",
        reason: "invoked skills exceeded restore budget",
      },
    ]);
  });

  it("records a skip reason when there are no invoked skills", async () => {
    const result = await createSkillRestoreAttachments(new Map());

    expect(result.attachments).toEqual([]);
    expect(result.diagnostics.generated).toEqual([]);
    expect(result.diagnostics.skipped).toEqual([
      { type: "invoked_skills", reason: "no invoked skills" },
    ]);
  });

  it("provides empty extension points for future restore sources", async () => {
    await expect(createPlanRestoreAttachments()).resolves.toEqual([]);
    await expect(createBackgroundTaskRestoreAttachments()).resolves.toEqual([]);
  });
});
