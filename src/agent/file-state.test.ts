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

  it('部分读取（offset 有值）应拒绝编辑', () => {
    cache.recordRead('/foo.ts', 'partial', 1000, 10, undefined);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
      expect(result.reason).toContain('partially read');
    }
  });

  it('部分读取（limit 有值）应拒绝编辑', () => {
    cache.recordRead('/foo.ts', 'partial', 1000, undefined, 20);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
      expect(result.reason).toContain('partially read');
    }
  });

  it('编辑后连续编辑无需重新读取', () => {
    cache.recordRead('/foo.ts', 'content', 1000);
    cache.recordEdit('/foo.ts', 'edited', 2000);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.content).toBe('edited');
      expect(result.record.timestamp).toBe(2000);
    }
  });

  it('clear() 清除所有记录', () => {
    cache.recordRead('/foo.ts', 'content', 1000);
    cache.clear();
    const editResult = cache.canEdit('/foo.ts');
    expect(editResult.ok).toBe(false);
    expect(cache.get('/foo.ts')).toBeUndefined();
  });

  it('get() 获取未记录文件返回 undefined', () => {
    expect(cache.get('/nonexistent.ts')).toBeUndefined();
  });

  it('多次读取同一文件覆盖更新', () => {
    cache.recordRead('/foo.ts', 'first', 1000);
    cache.recordRead('/foo.ts', 'second', 2000);
    const record = cache.get('/foo.ts');
    expect(record?.content).toBe('second');
    expect(record?.timestamp).toBe(2000);
  });

  it('recordRead 默认值检查', () => {
    cache.recordRead('/foo.ts', 'content', 1000);
    const record = cache.get('/foo.ts');
    expect(record?.isPartialView).toBe(false);
    expect(record?.offset).toBeUndefined();
    expect(record?.limit).toBeUndefined();
  });

  it('LRU 按大小淘汰（sizeCalculation）', () => {
    const smallCache = new FileStateCache({ maxEntries: 100, maxSizeBytes: 10 });
    smallCache.recordRead('/a.ts', '12345', 1000);
    smallCache.recordRead('/b.ts', '67890', 1000);
    smallCache.recordRead('/c.ts', 'abcde', 1000);
    expect(smallCache.get('/a.ts')).toBeUndefined();
    expect(smallCache.get('/b.ts')).toBeDefined();
    expect(smallCache.get('/c.ts')).toBeDefined();
  });

  it('canEdit 返回的 record 完整性', () => {
    cache.recordRead('/foo.ts', 'content', 1000, undefined, undefined, false);
    const result = cache.canEdit('/foo.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.content).toBe('content');
      expect(result.record.timestamp).toBe(1000);
      expect(result.record.isPartialView).toBe(false);
      expect(result.record.offset).toBeUndefined();
      expect(result.record.limit).toBeUndefined();
    }
  });

  it('recordEdit 后 isPartialView 强制为 false', () => {
    cache.recordRead('/foo.ts', 'content', 1000, undefined, undefined, true);
    cache.recordEdit('/foo.ts', 'edited', 2000);
    const record = cache.get('/foo.ts');
    expect(record?.isPartialView).toBe(false);
    expect(record?.content).toBe('edited');
  });
});
