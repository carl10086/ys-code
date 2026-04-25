import { describe, it, expect } from 'bun:test';
import { createEditTool } from './edit.js';
import { FileStateCache } from '../file-state.js';
import type { ToolUseContext } from '../types.js';
import { writeFile, readFile, unlink, stat, utimes } from 'fs/promises';
import { DIRTY_WRITE_MESSAGE } from './file-guard.js';

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
    await writeFile('/tmp/foo.ts', 'abc', 'utf-8');
    const stats = await stat('/tmp/foo.ts');
    cache.recordRead('/tmp/foo.ts', 'abc', Math.floor(stats.mtimeMs));
    const tool = createEditTool('/tmp');
    try {
      const result = await tool.validateInput!({
        file_path: '/tmp/foo.ts',
        old_string: 'a',
        new_string: 'b',
      }, mockContext(cache));
      expect(result.ok).toBe(true);
    } finally {
      await unlink('/tmp/foo.ts').catch(() => {});
    }
  });

  it('编辑后应更新缓存', async () => {
    const cache = new FileStateCache();
    cache.recordRead('/tmp/foo.ts', 'abc', Date.now());

    // 创建一个测试文件
    await writeFile('/tmp/foo.ts', 'abc', 'utf-8');
    // 等待一小段时间确保 mtime 变化
    await new Promise(r => setTimeout(r, 10));

    const tool = createEditTool('/tmp');
    try {
      await tool.execute!('test-id', {
        file_path: '/tmp/foo.ts',
        old_string: 'a',
        new_string: 'x',
      }, mockContext(cache));

      const record = cache.get('/tmp/foo.ts');
      expect(record?.content).toBe('xbc');
      expect(record?.offset).toBeUndefined();
      expect(record?.limit).toBeUndefined();
    } finally {
      // 清理
      await unlink('/tmp/foo.ts').catch(() => {});
    }
  });
});

describe('EditTool quote normalization', () => {
  it('should match curly quotes in file with straight quotes in old_string', async () => {
    const cache = new FileStateCache();
    const fileContent = 'He said "hello" to me';
    await writeFile('/tmp/curly.ts', fileContent, 'utf-8');
    const stats = await stat('/tmp/curly.ts');
    cache.recordRead('/tmp/curly.ts', fileContent, Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    try {
      const result = await tool.validateInput!({
        file_path: '/tmp/curly.ts',
        old_string: '"hello"',
        new_string: '"world"',
      }, mockContext(cache));
      expect(result.ok).toBe(true);
    } finally {
      await unlink('/tmp/curly.ts').catch(() => {});
    }
  });

  it('should preserve curly quote style in new_string', async () => {
    const cache = new FileStateCache();
    const fileContent = 'He said "hello" to me';
    await writeFile('/tmp/curly2.ts', fileContent, 'utf-8');
    const stats = await stat('/tmp/curly2.ts');
    cache.recordRead('/tmp/curly2.ts', fileContent, Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    try {
      const execResult = await tool.execute!('test-id', {
        file_path: '/tmp/curly2.ts',
        old_string: '"hello"',
        new_string: '"world"',
      }, mockContext(cache));

      expect(execResult.oldString).toBe('"hello"');
      const newContent = await readFile('/tmp/curly2.ts', 'utf-8');
      expect(newContent).toBe('He said "world" to me');
    } finally {
      await unlink('/tmp/curly2.ts').catch(() => {});
    }
  });

  it('should fall back to straight quotes when file has no curly quotes', async () => {
    const cache = new FileStateCache();
    const fileContent = 'He said "hello" to me';
    await writeFile('/tmp/straight.ts', fileContent, 'utf-8');
    const stats = await stat('/tmp/straight.ts');
    cache.recordRead('/tmp/straight.ts', fileContent, Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    try {
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
      const newContent = await readFile('/tmp/straight.ts', 'utf-8');
      expect(newContent).toBe('He said "world" to me');
    } finally {
      await unlink('/tmp/straight.ts').catch(() => {});
    }
  });
});

describe("Notebook 保护", () => {
  it("拒绝编辑 .ipynb 文件", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool('/tmp');
    const notebookPath = '/tmp/test.ipynb';
    await writeFile(notebookPath, '{"cells": []}', "utf-8");
    cache.recordRead(notebookPath, '{"cells": []}', Date.now());

    try {
      const result = await tool.validateInput!({
        file_path: notebookPath,
        old_string: "cells",
        new_string: "nodes",
      }, mockContext(cache));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe(5);
      }
      expect(result.ok === false && result.message).toContain("NotebookEditTool");
    } finally {
      await unlink(notebookPath).catch(() => {});
    }
  });
});

describe("Settings 保护", () => {
  it("允许产生合法 JSON 的编辑", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool('/tmp');
    const jsonPath = '/tmp/settings.json';
    const content = '{"name": "old", "value": 1}';
    await writeFile(jsonPath, content, "utf-8");
    cache.recordRead(jsonPath, content, Date.now());

    try {
      const result = await tool.validateInput!({
        file_path: jsonPath,
        old_string: '"name": "old"',
        new_string: '"name": "new"',
      }, mockContext(cache));
      expect(result.ok).toBe(true);
    } finally {
      await unlink(jsonPath).catch(() => {});
    }
  });

  it("拒绝产生非法 JSON 的编辑", async () => {
    const cache = new FileStateCache();
    const tool = createEditTool('/tmp');
    const jsonPath = '/tmp/settings.json';
    const content = '{"name": "old", "value": 1}';
    await writeFile(jsonPath, content, "utf-8");
    cache.recordRead(jsonPath, content, Date.now());

    try {
      const result = await tool.validateInput!({
        file_path: jsonPath,
        old_string: '"name": "old"',
        new_string: '"name": "new",',  // 尾部多余逗号导致非法 JSON
      }, mockContext(cache));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe(11);
        expect(result.message).toContain("invalid JSON");
      }
    } finally {
      await unlink(jsonPath).catch(() => {});
    }
  });
});
describe('EditTool dirty-write detection', () => {
  it('mtime 变化应触发 validateInput 拒绝（errorCode 7）', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/edit-dirty.txt', 'original content', 'utf-8');
    const stats = await stat('/tmp/edit-dirty.txt');
    cache.recordRead('/tmp/edit-dirty.txt', 'original content', Math.floor(stats.mtimeMs));

    // 模拟外部修改并推进 mtime
    await writeFile('/tmp/edit-dirty.txt', 'modified content', 'utf-8');
    // 推进 mtime 10 秒，确保大于读取时记录的 timestamp
    const future = new Date(Date.now() + 10000);
    await utimes('/tmp/edit-dirty.txt', future, future);

    const tool = createEditTool('/tmp');
    try {
      const result = await tool.validateInput!({
        file_path: '/tmp/edit-dirty.txt',
        old_string: 'original',
        new_string: 'updated',
      }, mockContext(cache));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe(7);
      }
    } finally {
      await unlink('/tmp/edit-dirty.txt').catch(() => {});
    }
  });

  it('mtime 变化但内容未变（全量读取）应通过', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/edit-same.txt', 'same content', 'utf-8');
    const stats = await stat('/tmp/edit-same.txt');
    cache.recordRead('/tmp/edit-same.txt', 'same content', Math.floor(stats.mtimeMs));

    // 只推进 mtime，不修改内容
    // 推进 mtime 10 秒，确保大于读取时记录的 timestamp
    const future = new Date(Date.now() + 10000);
    await utimes('/tmp/edit-same.txt', future, future);

    const tool = createEditTool('/tmp');
    try {
      const result = await tool.validateInput!({
        file_path: '/tmp/edit-same.txt',
        old_string: 'same',
        new_string: 'changed',
      }, mockContext(cache));

      expect(result.ok).toBe(true);
    } finally {
      await unlink('/tmp/edit-same.txt').catch(() => {});
    }
  });

  it('execute 中二次脏写检测应抛出异常', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/exec-dirty.txt', 'original', 'utf-8');
    const stats = await stat('/tmp/exec-dirty.txt');
    cache.recordRead('/tmp/exec-dirty.txt', 'original', Math.floor(stats.mtimeMs));

    // 通过 validateInput（此时 mtime 未变）
    const tool = createEditTool('/tmp');
    const validateResult = await tool.validateInput!({
      file_path: '/tmp/exec-dirty.txt',
      old_string: 'original',
      new_string: 'updated',
    }, mockContext(cache));
    expect(validateResult.ok).toBe(true);

    // 在 validateInput 和 execute 之间模拟外部修改
    await writeFile('/tmp/exec-dirty.txt', 'tampered', 'utf-8');
    // 推进 mtime 10 秒，确保大于读取时记录的 timestamp
    const future = new Date(Date.now() + 10000);
    await utimes('/tmp/exec-dirty.txt', future, future);

    try {
      // execute 应抛出异常
      await expect(tool.execute!('test-id', {
        file_path: '/tmp/exec-dirty.txt',
        old_string: 'original',
        new_string: 'updated',
      }, mockContext(cache))).rejects.toThrow(DIRTY_WRITE_MESSAGE);
    } finally {
      await unlink('/tmp/exec-dirty.txt').catch(() => {});
    }
  });
});
