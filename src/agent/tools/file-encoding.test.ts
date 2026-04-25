import { describe, it, expect } from "bun:test";
import { writeFile, readFile, unlink } from "fs/promises";
import { readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";
import { join } from "path";
import { tmpdir } from "os";

function tempPath(name: string): string {
  return join(tmpdir(), `ys-test-${Date.now()}-${name}`);
}

describe("readFileWithEncoding", () => {
  it("读取 UTF-8 + LF", async () => {
    const path = tempPath("utf8-lf.txt");
    await writeFile(path, "hello\nworld", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("hello\nworld");
      expect(result.encoding.encoding).toBe("utf8");
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("读取 UTF-8 + CRLF", async () => {
    const path = tempPath("utf8-crlf.txt");
    await writeFile(path, "hello\r\nworld", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("hello\nworld");
      expect(result.encoding.encoding).toBe("utf8");
      expect(result.encoding.lineEndings).toBe("\r\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("读取 UTF-16 LE + BOM + LF", async () => {
    const path = tempPath("utf16-lf.txt");
    const buffer = Buffer.from([0xff, 0xfe, ...Buffer.from("hello\nworld", "utf16le")]);
    await writeFile(path, buffer);
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("hello\nworld");
      expect(result.encoding.encoding).toBe("utf16le");
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("空文件默认 utf8 + \\n", async () => {
    const path = tempPath("empty.txt");
    await writeFile(path, "");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.content).toBe("");
      expect(result.encoding.encoding).toBe("utf8");
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("混合行尾（\\r\\n 占多数）", async () => {
    const path = tempPath("mixed-crlf.txt");
    // 3 个 CRLF, 1 个 LF
    await writeFile(path, "a\r\nb\r\nc\r\nd\ne", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.encoding.lineEndings).toBe("\r\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("混合行尾（\\n 占多数）", async () => {
    const path = tempPath("mixed-lf.txt");
    // 1 个 CRLF, 3 个 LF
    await writeFile(path, "a\r\nb\nc\nd\ne", "utf-8");
    try {
      const result = await readFileWithEncoding(path);
      expect(result.encoding.lineEndings).toBe("\n");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});

describe("writeFileWithEncoding", () => {
  it("恢复 CRLF", async () => {
    const path = tempPath("write-crlf.txt");
    try {
      await writeFileWithEncoding(path, "hello\nworld", { encoding: "utf8", lineEndings: "\r\n" });
      const raw = await readFile(path, "utf-8");
      expect(raw).toBe("hello\r\nworld");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("恢复 UTF-16", async () => {
    const path = tempPath("write-utf16.txt");
    try {
      await writeFileWithEncoding(path, "hello", { encoding: "utf16le", lineEndings: "\n" });
      const raw = await readFile(path);
      expect(raw[0]).toBe(0xff);
      expect(raw[1]).toBe(0xfe);
      const content = raw.toString("utf16le").replace(/^﻿/, "");
      expect(content).toBe("hello");
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});
