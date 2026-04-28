import { describe, it, expect } from "bun:test";
import { validateUrl, truncateContent } from "./webfetch-utils.js";

describe("validateUrl", () => {
  it("accepts valid public URLs", () => {
    expect(validateUrl("https://example.com/docs")).toBe(true);
    expect(validateUrl("https://api.github.com/repos/owner/repo")).toBe(true);
    expect(validateUrl("http://example.com")).toBe(true);
  });

  it("rejects localhost", () => {
    expect(validateUrl("http://localhost:3000/api")).toBe(false);
    expect(validateUrl("https://localhost")).toBe(false);
  });

  it("rejects localhost variants", () => {
    expect(validateUrl("http://localhost.localdomain")).toBe(false);
    expect(validateUrl("https://localhost6")).toBe(false);
    expect(validateUrl("http://ip6-localhost")).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(validateUrl("http://127.0.0.1:8080")).toBe(false);
    expect(validateUrl("https://127.0.0.1")).toBe(false);
  });

  it("rejects 127.x.x.x loopback range", () => {
    expect(validateUrl("http://127.0.0.2")).toBe(false);
    expect(validateUrl("http://127.255.255.255")).toBe(false);
  });

  it("rejects ::1", () => {
    expect(validateUrl("http://[::1]:3000")).toBe(false);
    expect(validateUrl("https://[::1]")).toBe(false);
  });

  it("rejects IPv6 loopback full form", () => {
    expect(validateUrl("http://[0:0:0:0:0:0:0:1]")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 loopback", () => {
    expect(validateUrl("http://[::ffff:127.0.0.1]")).toBe(false);
    expect(validateUrl("http://[::ffff:10.0.0.1]")).toBe(false);
  });

  it("rejects private IP ranges", () => {
    expect(validateUrl("http://10.0.0.1")).toBe(false);
    expect(validateUrl("http://172.16.0.1")).toBe(false);
    expect(validateUrl("http://172.31.255.255")).toBe(false);
    expect(validateUrl("http://192.168.1.1")).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    expect(validateUrl("http://0.0.0.0")).toBe(false);
    expect(validateUrl("http://0.0.0.1")).toBe(false);
  });

  it("rejects 169.254.x.x link-local", () => {
    expect(validateUrl("http://169.254.1.1")).toBe(false);
  });

  it("rejects IPv6 ULA", () => {
    expect(validateUrl("http://[fc00::1]")).toBe(false);
    expect(validateUrl("http://[fd00:1234::1]")).toBe(false);
  });

  it("rejects IPv6 link-local", () => {
    expect(validateUrl("http://[fe80::1]")).toBe(false);
    expect(validateUrl("http://[fe80:1234::1]")).toBe(false);
  });

  it("rejects URLs with username/password", () => {
    expect(validateUrl("https://user:pass@example.com")).toBe(false);
  });

  it("rejects file protocol", () => {
    expect(validateUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects data protocol", () => {
    expect(validateUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects javascript protocol", () => {
    expect(validateUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(validateUrl("not-a-url")).toBe(false);
    expect(validateUrl("")).toBe(false);
  });

  it("rejects URLs longer than 2000 chars", () => {
    expect(validateUrl("https://example.com/" + "a".repeat(2000))).toBe(false);
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

  it("respects custom maxLength", () => {
    const content = "c".repeat(100);
    expect(truncateContent(content, 50).length).toBeLessThanOrEqual(50 + "\n\n[Content truncated due to length...]".length);
    expect(truncateContent(content, 50)).toContain("[Content truncated due to length...]");
  });
});
