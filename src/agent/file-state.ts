import { LRUCache } from 'lru-cache';
import { normalize } from 'path';

/**
 * 文件读取记录
 */
export interface FileReadRecord {
  /** 读取时的文件内容（用于后续内容对比，防止时间戳误报） */
  content: string;
  /** 读取时的文件修改时间（fs.stat().mtimeMs） */
  timestamp: number;
  /** 部分读取时的起始行号（1-based，全量读取为 undefined） */
  offset?: number;
  /** 部分读取时的行数限制（全量读取为 undefined） */
  limit?: number;
  /** 是否为部分视图（如 CLAUDE.md 自动注入的内容） */
  isPartialView?: boolean;
}

/**
 * 文件状态缓存
 * 基于 LRUCache 实现内存受限的文件读取状态管理
 */
export class FileStateCache {
  private cache: LRUCache<string, FileReadRecord>;

  constructor(options?: { maxEntries?: number; maxSizeBytes?: number }) {
    this.cache = new LRUCache<string, FileReadRecord>({
      max: options?.maxEntries ?? 100,
      maxSize: options?.maxSizeBytes ?? 25 * 1024 * 1024,
      sizeCalculation: (value) => Math.max(1, Buffer.byteLength(value.content)),
    });
  }

  /**
   * 记录一次文件读取
   */
  recordRead(
    path: string,
    content: string,
    timestamp: number,
    offset?: number,
    limit?: number,
    isPartialView?: boolean,
  ): void {
    this.cache.set(normalize(path), {
      content,
      timestamp,
      offset,
      limit,
      isPartialView: isPartialView ?? false,
    });
  }

  /**
   * 检查文件是否可以编辑
   */
  canEdit(path: string):
    | { ok: true; record: FileReadRecord }
    | { ok: false; reason: string; errorCode: number } {
    const record = this.cache.get(normalize(path));

    if (!record) {
      return {
        ok: false,
        reason: `File has not been read yet. Read it first before writing to it.`,
        errorCode: 6,
      };
    }

    if (record.isPartialView || record.offset !== undefined || record.limit !== undefined) {
      return {
        ok: false,
        reason: `File has only been partially read. Read the full file before writing to it.`,
        errorCode: 6,
      };
    }

    return { ok: true, record };
  }

  /**
   * 更新编辑后的文件状态
   */
  recordEdit(path: string, newContent: string, newTimestamp: number): void {
    this.cache.set(normalize(path), {
      content: newContent,
      timestamp: newTimestamp,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
  }

  /** 获取记录 */
  get(path: string): FileReadRecord | undefined {
    return this.cache.get(normalize(path));
  }

  /** 清除所有记录 */
  clear(): void {
    this.cache.clear();
  }
}
