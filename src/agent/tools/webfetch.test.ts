import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebFetchTool, __testConfig } from "./webfetch.js";

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

  it("cancels fetch when abort signal is triggered", async () => {
    const abortController = new AbortController();

    globalThis.fetch = (async (_url: any, init?: any) => {
      // Wait for abort signal
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Aborted"));
        });
      });
    }) as any;

    const executePromise = tool.execute(
      "call-abort",
      { url: "https://example.com", prompt: "test" },
      { abortSignal: abortController.signal } as any,
    );

    // Trigger abort after a short delay
    setTimeout(() => abortController.abort(), 10);

    await expect(executePromise).rejects.toThrow();
  });

  it("times out fetch after configured duration", async () => {
    const originalTimeout = __testConfig.fetchTimeoutMs;
    __testConfig.fetchTimeoutMs = 50; // Short timeout for testing

    globalThis.fetch = (async (_url: any, init?: any) => {
      // Return a promise that resolves when aborted or after a long time
      return new Promise((_resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (init?.signal?.aborted) {
            clearInterval(checkInterval);
            reject(new Error("Timeout"));
          }
        }, 5);
      });
    }) as any;

    const startTime = Date.now();
    await expect(
      tool.execute(
        "call-timeout",
        { url: "https://example.com", prompt: "test" },
        { abortSignal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow();

    __testConfig.fetchTimeoutMs = originalTimeout;

    // Should have taken close to 50ms (with some margin)
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThanOrEqual(500);
  });

  it("propagates network errors", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as any;

    await expect(
      tool.execute(
        "call-network-error",
        { url: "https://example.com", prompt: "test" },
        { abortSignal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow("fetch failed");
  });
});
