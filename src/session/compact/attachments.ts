import { stat } from "fs/promises";
import type { FileStateCache } from "../../agent/file-state.js";
import { readAtMentionedFile } from "../../agent/attachments/at-mention.js";
import type { AttachmentMessage } from "../../agent/attachments/types.js";

export interface PostCompactFileAttachmentOptions {
  cwd: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export async function createPostCompactFileAttachments(
  fileStateCache: FileStateCache,
  options: PostCompactFileAttachmentOptions,
): Promise<AttachmentMessage[]> {
  const maxFiles = options.maxFiles ?? 10;
  const snapshot = fileStateCache.snapshot().slice(0, maxFiles);
  const attachments: AttachmentMessage[] = [];

  for (const entry of snapshot) {
    try {
      const stats = await stat(entry.path);
      if (
        options.maxBytesPerFile !== undefined &&
        stats.size > options.maxBytesPerFile
      ) {
        continue;
      }
    } catch {
      continue;
    }

    const attachment = await readAtMentionedFile(entry.path, options.cwd);
    if (!attachment) {
      continue;
    }

    attachments.push({
      role: "attachment",
      attachment,
      timestamp: Date.now(),
    });
  }

  return attachments;
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
