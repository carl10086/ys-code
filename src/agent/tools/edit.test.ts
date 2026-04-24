import { describe, it, expect, beforeEach } from 'bun:test';
import { createEditTool } from './edit.js';
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

describe('EditTool read-before-write', () => {
  it('未读取文件应拒绝编辑', async () => {
    const cache = new FileStateCache();
    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'b',
    }, mockContext(cache));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }
  });

  it('读取后应允许编辑', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/foo.ts', 'abc', 'utf-8');
    const stats = await fs.stat('/tmp/foo.ts');
    cache.recordRead('/tmp/foo.ts', 'abc', Math.floor(stats.mtimeMs));
    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'b',
    }, mockContext(cache));
    expect(result.ok).toBe(true);
    await fs.unlink('/tmp/foo.ts').catch(() => {});
  });

  it('编辑后应更新缓存', async () => {
    const cache = new FileStateCache();
    cache.recordRead('/tmp/foo.ts', 'abc', Date.now());

    // 创建一个测试文件
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/foo.ts', 'abc', 'utf-8');
    // 等待一小段时间确保 mtime 变化
    await new Promise(r => setTimeout(r, 10));

    const tool = createEditTool('/tmp');
    await tool.execute!('test-id', {
      file_path: '/tmp/foo.ts',
      old_string: 'a',
      new_string: 'x',
    }, mockContext(cache));

    const record = cache.get('/tmp/foo.ts');
    expect(record?.content).toBe('xbc');
    expect(record?.offset).toBeUndefined();
    expect(record?.limit).toBeUndefined();

    // 清理
    await fs.unlink('/tmp/foo.ts').catch(() => {});
  });
});

describe('EditTool quote normalization', () => {
  it('should match curly quotes in file with straight quotes in old_string', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    const fileContent = 'He said "hello" to me';
    await fs.writeFile('/tmp/curly.ts', fileContent, 'utf-8');
    const stats = await fs.stat('/tmp/curly.ts');
    cache.recordRead('/tmp/curly.ts', fileContent, Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/curly.ts',
      old_string: '"hello"',
      new_string: '"world"',
    }, mockContext(cache));
    expect(result.ok).toBe(true);

    await fs.unlink('/tmp/curly.ts').catch(() => {});
  });

  it('should preserve curly quote style in new_string', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    const fileContent = 'He said "hello" to me';
    await fs.writeFile('/tmp/curly2.ts', fileContent, 'utf-8');
    const stats = await fs.stat('/tmp/curly2.ts');
    cache.recordRead('/tmp/curly2.ts', fileContent, Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    const execResult = await tool.execute!('test-id', {
      file_path: '/tmp/curly2.ts',
      old_string: '"hello"',
      new_string: '"world"',
    }, mockContext(cache));

    expect(execResult.oldString).toBe('"hello"');
    const newContent = await fs.readFile('/tmp/curly2.ts', 'utf-8');
    expect(newContent).toBe('He said "world" to me');

    await fs.unlink('/tmp/curly2.ts').catch(() => {});
  });

  it('should fall back to straight quotes when file has no curly quotes', async () => {
    const cache = new FileStateCache();
    const fs = await import('fs/promises');
    const fileContent = 'He said "hello" to me';
    await fs.writeFile('/tmp/straight.ts', fileContent, 'utf-8');
    const stats = await fs.stat('/tmp/straight.ts');
    cache.recordRead('/tmp/straight.ts', fileContent, Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/straight.ts',
      old_string: '"hello"',
      new_string: '"world"',
    }, mockContext(cache));
    expect(result.ok).toBe(true);

    const execResult = await tool.execute!('test-id', {
      file_path: '/tmp/straight.ts',
      old_string: '"hello"',
      new_string: '"world"',
    }, mockContext(cache));

    expect(execResult.oldString).toBe('"hello"');
    const newContent = await fs.readFile('/tmp/straight.ts', 'utf-8');
    expect(newContent).toBe('He said "world" to me');

    await fs.unlink('/tmp/straight.ts').catch(() => {});
  });
});
