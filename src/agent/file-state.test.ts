import { describe, it, expect, beforeEach } from 'bun:test';
import { FileStateCache } from './file-state.js';

describe('FileStateCache', () => {
  let cache: FileStateCache;

  beforeEach(() => {
    cache = new FileStateCache();
  });

  it('全量读取后应允许编辑', () => {
    cache.recordRead('/foo.ts', 'content', 1000);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.content).toBe('content');
      expect(result.record.timestamp).toBe(1000);
    }
  });

  it('未读取文件应拒绝编辑', () => {
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
      expect(result.reason).toContain('not been read');
    }
  });

  it('部分视图应拒绝编辑', () => {
    cache.recordRead('/foo.ts', 'content', 1000, undefined, undefined, true);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }
  });

  it('编辑后应更新记录', () => {
    cache.recordRead('/foo.ts', 'old', 1000);
    cache.recordEdit('/foo.ts', 'new', 2000);
    const record = cache.get('/foo.ts');
    expect(record?.content).toBe('new');
    expect(record?.timestamp).toBe(2000);
    expect(record?.offset).toBeUndefined();
    expect(record?.limit).toBeUndefined();
    expect(record?.isPartialView).toBe(false);
  });

  it('路径应规范化', () => {
    cache.recordRead('/foo/bar.ts', 'content', 1000);
    const result = cache.canEdit('/foo//bar.ts');
    expect(result.ok).toBe(true);
  });

  it('LRU 应自动淘汰旧项', () => {
    const smallCache = new FileStateCache({ maxEntries: 2, maxSizeBytes: 100 });
    smallCache.recordRead('/a.ts', 'a'.repeat(50), 1000);
    smallCache.recordRead('/b.ts', 'b'.repeat(50), 1000);
    smallCache.recordRead('/c.ts', 'c'.repeat(50), 1000);
    expect(smallCache.get('/a.ts')).toBeUndefined();
    expect(smallCache.get('/c.ts')).toBeDefined();
  });
});
