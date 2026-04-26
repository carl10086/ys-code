import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { extractAtMentionedFiles, readAtMentionedFile } from "./at-mention.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("extractAtMentionedFiles", () => {
  it("提取单个普通路径", () => {
    const result = extractAtMentionedFiles("查看 @src/utils/logger.ts 的代码");
    expect(result).toEqual(["src/utils/logger.ts"]);
  });

  it("提取多个普通路径", () => {
    const result = extractAtMentionedFiles("对比 @a.ts 和 @b.ts 的区别");
    expect(result).toEqual(["a.ts", "b.ts"]);
  });

  it("提取带引号的路径（包含空格）", () => {
    const result = extractAtMentionedFiles('查看 @"my file.ts" 的代码');
    expect(result).toEqual(["my file.ts"]);
  });

  it("无匹配时返回空数组", () => {
    const result = extractAtMentionedFiles("普通消息");
    expect(result).toEqual([]);
  });

  it("排除 email 地址", () => {
    const result = extractAtMentionedFiles("联系 user@example.com");
    expect(result).toEqual([]);
  });

  it("同时包含路径和 email 时只提取路径", () => {
    const result = extractAtMentionedFiles("发送给 admin@test.com 并查看 @config.yml");
    expect(result).toEqual(["config.yml"]);
  });

  it("支持根路径", () => {
    const result = extractAtMentionedFiles("查看 @/README.md");
    expect(result).toEqual(["/README.md"]);
  });

  it("支持相对路径 ./ 和 ../", () => {
    const result = extractAtMentionedFiles("查看 @./local.ts 和 @../parent.ts");
    expect(result).toEqual(["./local.ts", "../parent.ts"]);
  });

  it("提取多个带引号路径", () => {
    const result = extractAtMentionedFiles('对比 @"file a.ts" 和 @"file b.ts"');
    expect(result).toEqual(["file a.ts", "file b.ts"]);
  });

  it("引号路径与普通路径混合", () => {
    const result = extractAtMentionedFiles('查看 @src/main.ts 和 @"my docs/readme.md"');
    expect(result).toEqual(["src/main.ts", "my docs/readme.md"]);
  });

  it("排除纯数字和特殊字符开头的假匹配", () => {
    const result = extractAtMentionedFiles("价格 100@200 元");
    expect(result).toEqual([]);
  });

  it("支持中文字符后的路径", () => {
    const result = extractAtMentionedFiles("请查看@文件.ts的内容");
    expect(result).toEqual(["文件.ts"]);
  });
});

describe("readAtMentionedFile", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "at-mention-"));
    fs.writeFileSync(join(tmpDir, "small.txt"), "line1\nline2");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("应读取存在的文件并返回 FileAttachment", async () => {
    const result = await readAtMentionedFile(path.join(tmpDir, "small.txt"), tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("file");
    const fileResult = result as import("./types.js").FileAttachment;
    expect(fileResult.filePath).toBe(path.join(tmpDir, "small.txt"));
    expect(fileResult.displayPath).toBe("small.txt");
    // content 现在是 FileReadToolOutput 对象
    expect(fileResult.content.type).toBe("text");
    expect(fileResult.content.file!.content).toContain("line1");
    expect(fileResult.truncated).toBeUndefined();
  });

  it("应读取目录并返回 DirectoryAttachment", async () => {
    const result = await readAtMentionedFile(tmpDir, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("directory");
    const dirResult = result as import("./types.js").DirectoryAttachment;
    expect(dirResult.path).toBe(tmpDir);
    expect(dirResult.displayPath).toBe(".");
    expect(dirResult.content).toContain("small.txt");
  });

  it("相对路径应基于 cwd 解析为绝对路径", async () => {
    const result = await readAtMentionedFile("./small.txt", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("file");
    const relResult = result as import("./types.js").FileAttachment;
    expect(relResult.filePath).toBe(path.join(tmpDir, "small.txt"));
  });

  it("不存在的文件应返回 null", async () => {
    const result = await readAtMentionedFile(path.join(tmpDir, "not-exist.txt"), tmpDir);
    expect(result).toBeNull();
  });

  it("大文件（>200KB）应截断前 1000 行并标记 truncated", async () => {
    const bigFile = path.join(tmpDir, "big.txt");
    const line = "这是填充内容以使文件超过 200KB 的限制阈值，继续填充更多内容以确保超过 200KB 的限制阈值".repeat(10);
    const lines: string[] = [];
    for (let i = 0; i < 1200; i++) {
      lines.push("第 " + i + " 行 " + line);
    }
    fs.writeFileSync(bigFile, lines.join("\n"));
    const result = await readAtMentionedFile(bigFile, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("file");
    const bigResult = result as import("./types.js").FileAttachment;
    expect(bigResult.truncated).toBe(true);
    // content 是 FileReadToolOutput 对象
    const fileContent = bigResult.content.file!.content;
    const lineCount = (fileContent.match(/\n/g) || []).length;
    expect(lineCount).toBeLessThanOrEqual(1000);
    fs.unlinkSync(bigFile);
  });

  it("应包含 timestamp", async () => {
    const before = Date.now();
    const result = await readAtMentionedFile(path.join(tmpDir, "small.txt"), tmpDir);
    const after = Date.now();
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp).toBeLessThanOrEqual(after);
  });
});
