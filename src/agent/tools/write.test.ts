import { describe, it, expect } from 'bun:test';
import { writeFile, readFile, unlink, stat, utimes } from 'fs/promises';
import { join } from 'path';
import { DIRTY_WRITE_MESSAGE } from './file-guard.js';
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
    await writeFile('/tmp/write-exists.txt', 'existing', 'utf-8');

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-exists.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(6);
    }

    await unlink('/tmp/write-exists.txt').catch(() => {});
  });

  it('覆盖已有文件（已读取）应允许', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-allowed.txt', 'existing', 'utf-8');
    const stats = await stat('/tmp/write-allowed.txt');
    cache.recordRead('/tmp/write-allowed.txt', 'existing', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-allowed.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(true);
    await unlink('/tmp/write-allowed.txt').catch(() => {});
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

    const content = await readFile('/tmp/write-create.txt', 'utf-8');
    expect(content).toBe('created content');
    await unlink('/tmp/write-create.txt').catch(() => {});
  });

  it('execute 覆盖已有文件', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-update.txt', 'old content', 'utf-8');
    const stats = await stat('/tmp/write-update.txt');
    cache.recordRead('/tmp/write-update.txt', 'old content', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const result = await tool.execute!('test-id', {
      file_path: '/tmp/write-update.txt',
      content: 'updated content',
    }, mockContext(cache));

    expect(result.type).toBe('update');
    expect(result.originalFile).toBe('old content');

    const content = await readFile('/tmp/write-update.txt', 'utf-8');
    expect(content).toBe('updated content');
    await unlink('/tmp/write-update.txt').catch(() => {});
  });

  it('连续写入无需重新读取', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-sequential.txt', 'first', 'utf-8');
    const stats = await stat('/tmp/write-sequential.txt');
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

    await unlink('/tmp/write-sequential.txt').catch(() => {});
  });

  it('脏写检测应触发 errorCode 7', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-dirty.txt', 'original', 'utf-8');
    const stats = await stat('/tmp/write-dirty.txt');
    cache.recordRead('/tmp/write-dirty.txt', 'original', Math.floor(stats.mtimeMs));

    // 模拟外部修改：修改内容并推进 mtime
    await writeFile('/tmp/write-dirty.txt', 'modified', 'utf-8');
    const future = new Date(Date.now() + 10000);
    await utimes('/tmp/write-dirty.txt', future, future);

    const tool = createWriteTool('/tmp');
    const result = await tool.validateInput!({
      file_path: '/tmp/write-dirty.txt',
      content: 'new content',
    }, mockContext(cache));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(7);
    }

    await unlink('/tmp/write-dirty.txt').catch(() => {});
  });

  it('execute 中二次脏写检测应抛出异常', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/exec-dirty-write.txt', 'original', 'utf-8');
    const stats = await stat('/tmp/exec-dirty-write.txt');
    cache.recordRead('/tmp/exec-dirty-write.txt', 'original', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');

    // 通过 validateInput
    const validateResult = await tool.validateInput!({
      file_path: '/tmp/exec-dirty-write.txt',
      content: 'updated',
    }, mockContext(cache));
    expect(validateResult.ok).toBe(true);

    // 在 validateInput 和 execute 之间模拟外部修改
    await writeFile('/tmp/exec-dirty-write.txt', 'tampered', 'utf-8');
    const future = new Date(Date.now() + 10000);
    await utimes('/tmp/exec-dirty-write.txt', future, future);

    // execute 应抛出异常
    await expect(tool.execute!('test-id', {
      file_path: '/tmp/exec-dirty-write.txt',
      content: 'updated',
    }, mockContext(cache))).rejects.toThrow(DIRTY_WRITE_MESSAGE);

    await unlink('/tmp/exec-dirty-write.txt').catch(() => {});
  });
});

describe("编码/行尾保持", () => {
  it("覆盖文件时保持 CRLF 行尾", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const path = join('/tmp', "write-crlf.txt");
    await writeFile(path, "original\r\ncontent", "utf-8");
    cache.recordRead(path, "original\r\ncontent", Date.now());

    try {
      await tool.execute!("test", {
        file_path: path,
        content: "new\ncontent",
      }, mockContext(cache));

      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("new\r\ncontent");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("覆盖文件时保持 UTF-16 编码", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const path = join('/tmp', "write-utf16.txt");
    const buffer = Buffer.from([0xff, 0xfe, ...Buffer.from("original", "utf16le")]);
    await writeFile(path, buffer);
    cache.recordRead(path, "original", Date.now());

    try {
      await tool.execute!("test", {
        file_path: path,
        content: "new",
      }, mockContext(cache));

      const raw = await readFile(path);
      expect(raw[0]).toBe(0xff);
      expect(raw[1]).toBe(0xfe);
      const content = raw.toString("utf16le").replace(/^﻿/, "");
      expect(content).toBe("new");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("创建新文件使用默认编码", async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const path = join('/tmp', "new-file.txt");

    try {
      await tool.execute!("test", {
        file_path: path,
        content: "hello\nworld",
      }, mockContext(cache));

      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("hello\nworld");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});
