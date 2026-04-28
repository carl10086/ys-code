import { describe, it, expect } from "bun:test";
import { validateUrl, truncateContent } from "./webfetch-utils.js";

describe("validateUrl", () => {
  it("accepts valid public URLs", () => {
    expect(validateUrl("https://example.com/docs")).toBe(true);
    expect(validateUrl("https://api.github.com/repos/owner/repo")).toBe(true);
    expect(validateUrl("http://example.com")).toBe(true); // http allowed, will be upgraded
  });

  it("rejects localhost", () => {
    expect(validateUrl("http://localhost:3000/api")).toBe(false);
    expect(validateUrl("https://localhost")).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(validateUrl("http://127.0.0.1:8080")).toBe(false);
    expect(validateUrl("https://127.0.0.1")).toBe(false);
  });

  it("rejects ::1", () => {
    expect(validateUrl("http://[::1]:3000")).toBe(false);
  });

  it("rejects private IP ranges", () => {
    expect(validateUrl("http://10.0.0.1")).toBe(false);
    expect(validateUrl("http://172.16.0.1")).toBe(false);
    expect(validateUrl("http://172.31.255.255")).toBe(false);
    expect(validateUrl("http://192.168.1.1")).toBe(false);
  });

  it("rejects URLs with username/password", () => {
    expect(validateUrl("https://user:pass@example.com")).toBe(false);
  });

  it("rejects file protocol", () => {
    expect(validateUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(validateUrl("not-a-url")).toBe(false);
    expect(validateUrl("")).toBe(false);
  });
});

describe("truncateContent", () => {
  it("returns short content as-is", () => {
    const content = "Short content";
    expect(truncateContent(content)).toBe(content);
  });

  it("truncates content exceeding MAX_CONTENT_LENGTH", () => {
    const longContent = "a".repeat(60_000);
    const result = truncateContent(longContent);
    expect(result.length).toBeLessThanOrEqual(50_000 + "\n\n[Content truncated due to length...]".length);
    expect(result).toContain("[Content truncated due to length...]");
  });

  it("truncates exactly at MAX_CONTENT_LENGTH boundary", () => {
    const exactContent = "b".repeat(50_000);
    expect(truncateContent(exactContent)).toBe(exactContent);
  });
});
