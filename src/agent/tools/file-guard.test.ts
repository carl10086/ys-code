import { describe, it, expect } from 'bun:test';
import { checkFileSize, MAX_FILE_SIZE_BYTES } from './file-guard.js';
import { writeFile, unlink } from 'fs/promises';

describe('checkFileSize', () => {
  it('小文件应通过检查', async () => {
    await writeFile('/tmp/small.txt', 'hello', 'utf-8');
    try {
      await expect(checkFileSize('/tmp/small.txt')).resolves.toBeUndefined();
    } finally {
      await unlink('/tmp/small.txt').catch(() => {});
    }
  });

  it('超过限制的文件应抛出错误', async () => {
    // 创建一个 2MB 的文件，限制为 1MB
    const content = 'x'.repeat(2 * 1024 * 1024);
    await writeFile('/tmp/large.txt', content, 'utf-8');
    try {
      await expect(checkFileSize('/tmp/large.txt', 1024 * 1024)).rejects.toThrow('File too large');
    } finally {
      await unlink('/tmp/large.txt').catch(() => {});
    }
  });

  it('不存在的文件应通过检查', async () => {
    await expect(checkFileSize('/tmp/nonexistent-guard.txt')).resolves.toBeUndefined();
  });

  it('MAX_FILE_SIZE_BYTES 应为 1GB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(1024 * 1024 * 1024);
  });
});
