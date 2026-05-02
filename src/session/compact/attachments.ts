import { realpath, stat } from "fs/promises";
import { basename, isAbsolute, relative, sep } from "path";
import type { FileStateCache } from "../../agent/file-state.js";
import type { AttachmentMessage } from "../../agent/attachments/types.js";
import { containsSecret } from "./prompt.js";

export const DEFAULT_POST_COMPACT_MAX_BYTES_PER_FILE = 200_000;
export const DEFAULT_POST_COMPACT_MAX_TOTAL_BYTES = 400_000;

export interface PostCompactFileAttachmentOptions {
  cwd: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export async function createPostCompactFileAttachments(
  fileStateCache: FileStateCache,
  options: PostCompactFileAttachmentOptions,
): Promise<AttachmentMessage[]> {
  const maxFiles = options.maxFiles ?? 10;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_POST_COMPACT_MAX_BYTES_PER_FILE;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_POST_COMPACT_MAX_TOTAL_BYTES;
  const snapshot = fileStateCache.snapshot();
  const attachments: AttachmentMessage[] = [];
  let totalBytes = 0;
  const realCwd = await realpath(options.cwd);

  for (const entry of snapshot) {
    if (
      entry.record.isPartialView ||
      entry.record.offset !== undefined ||
      entry.record.limit !== undefined
    ) {
      continue;
    }

    try {
      const realEntryPath = await realpath(entry.path);
      if (!isPathInside(realEntryPath, realCwd) || isSensitivePath(realEntryPath, realCwd)) {
        continue;
      }

      const stats = await stat(realEntryPath);
      if (!stats.isFile()) {
        continue;
      }
    } catch {
      continue;
    }

    if (containsSecret(entry.record.content)) {
      continue;
    }

    const contentBytes = Buffer.byteLength(entry.record.content);
    if (
      contentBytes > maxBytesPerFile ||
      totalBytes + contentBytes > maxTotalBytes
    ) {
      continue;
    }

    const lineCount = entry.record.content.split("\n").length;
    const displayPath = relative(realCwd, entry.path) || ".";
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

    if (attachments.length >= maxFiles) {
      break;
    }
  }

  return attachments;
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

export async function createSkillRestoreAttachments(): Promise<AttachmentMessage[]> {
  return [];
}

export async function createPlanRestoreAttachments(): Promise<AttachmentMessage[]> {
  return [];
}

export async function createBackgroundTaskRestoreAttachments(): Promise<AttachmentMessage[]> {
  return [];
}
