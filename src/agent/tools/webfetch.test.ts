import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebFetchTool } from "./webfetch.js";

describe("WebFetchTool", () => {
  const tool = createWebFetchTool();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("validates input and rejects unsafe URLs", async () => {
    const result = await tool.validateInput!(
      { url: "http://localhost:3000", prompt: "test" },
      { abortSignal: new AbortController().signal } as any,
    );
    expect(result.ok).toBe(false);
  });

  it("fetches HTML and converts to markdown", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body><h1>Hello</h1><p>World</p></body></html>", {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html" }),
      })) as any;

    const output = await tool.execute(
      "call-1",
      { url: "https://example.com", prompt: "summarize" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.url).toBe("https://example.com");
    expect(output.code).toBe(200);
    expect(output.result).toContain("Hello");
  });

  it("fetches plain text without conversion", async () => {
    globalThis.fetch = (async () =>
      new Response("Plain text content", {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
      })) as any;

    const output = await tool.execute(
      "call-2",
      { url: "https://example.com/text.txt", prompt: "read" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.result).toBe("Plain text content");
  });

  it("handles HTTP errors", async () => {
    globalThis.fetch = (async () =>
      new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "content-type": "text/plain" }),
      })) as any;

    const output = await tool.execute(
      "call-3",
      { url: "https://example.com/missing", prompt: "read" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.code).toBe(404);
  });

  it("truncates long content", async () => {
    const longHtml = "<html><body><p>" + "a".repeat(60_000) + "</p></body></html>";
    globalThis.fetch = (async () =>
      new Response(longHtml, {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html" }),
      })) as any;

    const output = await tool.execute(
      "call-4",
      { url: "https://example.com/long", prompt: "read" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.result).toContain("[Content truncated due to length...]");
  });
});
