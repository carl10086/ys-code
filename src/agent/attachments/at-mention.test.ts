import { describe, it, expect } from "bun:test";
import { extractAtMentionedFiles } from "./at-mention.js";

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
