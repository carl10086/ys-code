import { describe, it, expect } from 'bun:test';
import { createWriteTool } from './write.js';
import { FileStateCache } from '../file-state.js';
import type { ToolUseContext } from '../types.js';

function mockContext(cache: FileStateCache): ToolUseContext {
  return {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    fileStateCache: cache,
  } as ToolUseContext;
}

describe('WriteTool', () => {
  it('创建新文件无需先读取', async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-new.txt',
      content: 'hello world',
    }, mockContext(cache));
    expect(result.ok).toBe(true);
  });

  it('覆盖已有文件（未读取）应拒绝', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-exists.txt', 'existing', 'utf-8');

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-exists.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }

    await fs.unlink('/tmp/write-exists.txt').catch(() => {});
  });

  it('覆盖已有文件（已读取）应允许', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-allowed.txt', 'existing', 'utf-8');
    const stats = await fs.stat('/tmp/write-allowed.txt');
    cache.recordRead('/tmp/write-allowed.txt', 'existing', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-allowed.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(true);
    await fs.unlink('/tmp/write-allowed.txt').catch(() => {});
  });

  it('execute 创建新文件', async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const result = await tool.execute!('test-id', {
      file_path: '/tmp/write-create.txt',
      content: 'created content',
    }, mockContext(cache));

    expect(result.type).toBe('create');
    expect(result.filePath).toBe('/tmp/write-create.txt');
    expect(result.originalFile).toBeNull();

    const fs = await import('fs/promises');
    const content = await fs.readFile('/tmp/write-create.txt', 'utf-8');
    expect(content).toBe('created content');
    await fs.unlink('/tmp/write-create.txt').catch(() => {});
  });

  it('execute 覆盖已有文件', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-update.txt', 'old content', 'utf-8');
    const stats = await fs.stat('/tmp/write-update.txt');
    cache.recordRead('/tmp/write-update.txt', 'old content', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const result = await tool.execute!('test-id', {
      file_path: '/tmp/write-update.txt',
      content: 'updated content',
    }, mockContext(cache));

    expect(result.type).toBe('update');
    expect(result.originalFile).toBe('old content');

    const content = await fs.readFile('/tmp/write-update.txt', 'utf-8');
    expect(content).toBe('updated content');
    await fs.unlink('/tmp/write-update.txt').catch(() => {});
  });

  it('连续写入无需重新读取', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-sequential.txt', 'first', 'utf-8');
    const stats = await fs.stat('/tmp/write-sequential.txt');
    cache.recordRead('/tmp/write-sequential.txt', 'first', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');

    // 第一次写入
    await tool.execute!('test-id', {
      file_path: '/tmp/write-sequential.txt',
      content: 'second',
    }, mockContext(cache));

    // 第二次写入不应需要重新读取
    const result = await tool.validateInput!({
      file_path: '/tmp/write-sequential.txt',
      content: 'third',
    }, mockContext(cache));
    expect(result.ok).toBe(true);

    await fs.unlink('/tmp/write-sequential.txt').catch(() => {});
  });

  it('脏写检测应触发 errorCode 7', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/write-dirty.txt', 'original', 'utf-8');
    const stats = await fs.stat('/tmp/write-dirty.txt');
    cache.recordRead('/tmp/write-dirty.txt', 'original', Math.floor(stats.mtimeMs));

    // 模拟外部修改：修改内容并推进 mtime
    await fs.writeFile('/tmp/write-dirty.txt', 'modified', 'utf-8');
    const future = new Date(Date.now() + 10000);
    await fs.utimes('/tmp/write-dirty.txt', future, future);

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-dirty.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(7);
    }

    await fs.unlink('/tmp/write-dirty.txt').catch(() => {});
  });
});
