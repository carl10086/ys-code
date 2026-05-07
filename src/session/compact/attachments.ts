import { realpath, stat } from "fs/promises";
import { basename, isAbsolute, relative, sep } from "path";
import type { FileStateCache } from "../../agent/file-state.js";
import type { AttachmentMessage } from "../../agent/attachments/types.js";
import type { InvokedSkillRecord } from "../../agent/types.js";
import { containsSecret } from "./prompt.js";

export const DEFAULT_POST_COMPACT_MAX_BYTES_PER_FILE = 200_000;
export const DEFAULT_POST_COMPACT_MAX_TOTAL_BYTES = 400_000;
export const DEFAULT_POST_COMPACT_MAX_BYTES_PER_SKILL = 20_000;
export const DEFAULT_POST_COMPACT_SKILLS_MAX_TOTAL_BYTES = 100_000;
const SKILL_TRUNCATION_MARKER =
  "\n\n[... skill content truncated for compaction]";

export interface CompactAttachmentDiagnostics {
  generated: Array<{
    type: string;
    displayName?: string;
    count?: number;
  }>;
  skipped: Array<{
    type: string;
    displayName?: string;
    reason: string;
  }>;
}

export interface PostCompactAttachmentResult {
  attachments: AttachmentMessage[];
  diagnostics: CompactAttachmentDiagnostics;
}

export interface SkillRestoreAttachmentOptions {
  maxBytesPerSkill?: number;
  maxTotalBytes?: number;
}

export interface PostCompactFileAttachmentOptions {
  cwd: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export async function createPostCompactFileAttachments(
  fileStateCache: FileStateCache,
  options: PostCompactFileAttachmentOptions,
): Promise<PostCompactAttachmentResult> {
  const maxFiles = options.maxFiles ?? 10;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_POST_COMPACT_MAX_BYTES_PER_FILE;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_POST_COMPACT_MAX_TOTAL_BYTES;
  const snapshot = fileStateCache.snapshot();
  const attachments: AttachmentMessage[] = [];
  const diagnostics: CompactAttachmentDiagnostics = { generated: [], skipped: [] };
  let totalBytes = 0;
  const realCwd = await realpath(options.cwd);

  if (snapshot.length === 0) {
    diagnostics.skipped.push({
      type: "file",
      reason: "no fileStateCache entries",
    });
    return { attachments, diagnostics };
  }

  for (const entry of snapshot) {
    if (
      entry.record.isPartialView ||
      entry.record.offset !== undefined ||
      entry.record.limit !== undefined
    ) {
      diagnostics.skipped.push({
        type: "file",
        displayName: entry.path,
        reason: "entry is partial view",
      });
      continue;
    }

    let realEntryPath: string;
    try {
      realEntryPath = await realpath(entry.path);
      if (!isPathInside(realEntryPath, realCwd)) {
        diagnostics.skipped.push({
          type: "file",
          displayName: entry.path,
          reason: "entry outside workspace",
        });
        continue;
      }
      if (isSensitivePath(realEntryPath, realCwd)) {
        diagnostics.skipped.push({
          type: "file",
          displayName: entry.path,
          reason: "sensitive path",
        });
        continue;
      }

      const stats = await stat(realEntryPath);
      if (!stats.isFile()) {
        diagnostics.skipped.push({
          type: "file",
          displayName: entry.path,
          reason: "not a file",
        });
        continue;
      }
    } catch {
      diagnostics.skipped.push({
        type: "file",
        displayName: entry.path,
        reason: "stat failed",
      });
      continue;
    }

    if (containsSecret(entry.record.content)) {
      diagnostics.skipped.push({
        type: "file",
        displayName: entry.path,
        reason: "contains secret",
      });
      continue;
    }

    const contentBytes = Buffer.byteLength(entry.record.content);
    if (contentBytes > maxBytesPerFile) {
      diagnostics.skipped.push({
        type: "file",
        displayName: entry.path,
        reason: "exceeds max bytes per file",
      });
      continue;
    }
    if (totalBytes + contentBytes > maxTotalBytes) {
      diagnostics.skipped.push({
        type: "file",
        displayName: entry.path,
        reason: "exceeds total bytes budget",
      });
      continue;
    }

    const lineCount = entry.record.content.split("\n").length;
    const displayPath = relative(realCwd, realEntryPath) || ".";
    totalBytes += contentBytes;

    attachments.push({
      role: "attachment",
      attachment: {
        type: "file",
        filePath: entry.path,
        displayPath,
        content: {
          type: "text",
          file: {
            filePath: entry.path,
            content: entry.record.content,
            numLines: lineCount,
            startLine: 1,
            totalLines: lineCount,
          },
        },
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });
    diagnostics.generated.push({
      type: "file",
      displayName: displayPath,
    });

    if (attachments.length >= maxFiles) {
      if (snapshot.indexOf(entry) < snapshot.length - 1) {
        diagnostics.skipped.push({
          type: "file",
          reason: "max files reached",
        });
      }
      break;
    }
  }

  return { attachments, diagnostics };
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isSensitivePath(filePath: string, cwd: string): boolean {
  const rel = relative(cwd, filePath);
  const segments = rel.split(sep);
  const name = basename(filePath).toLowerCase();

  return (
    segments.includes(".ssh") ||
    segments.includes(".aws") ||
    segments.includes(".kube") ||
    name.startsWith(".env") ||
    name === ".npmrc" ||
    name === ".netrc" ||
    name === ".pypirc" ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    name === "known_hosts" ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.includes("credentials")
  );
}

export async function createSkillRestoreAttachments(
  invokedSkills: ReadonlyMap<string, InvokedSkillRecord> = new Map(),
  options: SkillRestoreAttachmentOptions = {},
): Promise<PostCompactAttachmentResult> {
  const diagnostics: CompactAttachmentDiagnostics = {
    generated: [],
    skipped: [],
  };
  const records = Array.from(invokedSkills.values())
    .sort((a, b) => b.invokedAt - a.invokedAt);

  if (records.length === 0) {
    diagnostics.skipped.push({
      type: "invoked_skills",
      reason: "no invoked skills",
    });
    return { attachments: [], diagnostics };
  }

  const maxBytesPerSkill = options.maxBytesPerSkill ?? DEFAULT_POST_COMPACT_MAX_BYTES_PER_SKILL;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_POST_COMPACT_SKILLS_MAX_TOTAL_BYTES;
  const skills: Array<{ name: string; path: string; content: string }> = [];
  let totalBytes = 0;

  for (const record of records) {
    const content = truncateSkillContent(record.content, maxBytesPerSkill);
    const contentBytes = Buffer.byteLength(content);
    if (totalBytes + contentBytes > maxTotalBytes) {
      diagnostics.skipped.push({
        type: "invoked_skills",
        displayName: record.name,
        reason: "invoked skills exceeded restore budget",
      });
      continue;
    }

    skills.push({
      name: record.name,
      path: record.path,
      content,
    });
    totalBytes += contentBytes;
  }

  if (skills.length === 0) {
    return { attachments: [], diagnostics };
  }

  const timestamp = Date.now();
  diagnostics.generated.push({
    type: "invoked_skills",
    count: skills.length,
  });

  return {
    attachments: [{
      role: "attachment",
      attachment: {
        type: "invoked_skills",
        skills,
        timestamp,
      },
      timestamp,
    }],
    diagnostics,
  };
}

function truncateSkillContent(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content) <= maxBytes) {
    return content;
  }
  return content.slice(0, maxBytes) + SKILL_TRUNCATION_MARKER;
}

export async function createPlanRestoreAttachments(): Promise<PostCompactAttachmentResult> {
  return {
    attachments: [],
    diagnostics: {
      generated: [],
      skipped: [{
        type: "plan_file_reference",
        reason: "plan restore unsupported: no stable plan state",
      }],
    },
  };
}

export async function createPlanModeRestoreAttachments(): Promise<PostCompactAttachmentResult> {
  return {
    attachments: [],
    diagnostics: {
      generated: [],
      skipped: [{
        type: "plan_mode",
        reason: "plan mode restore unsupported: no stable plan mode state",
      }],
    },
  };
}

export async function createBackgroundTaskRestoreAttachments(): Promise<AttachmentMessage[]> {
  return [];
}
