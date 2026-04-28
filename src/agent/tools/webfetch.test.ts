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
      { url: "http://localhost:3000" },
      { abortSignal: new AbortController().signal } as any,
    );
    expect(result.ok).toBe(false);
  });

  it("validates input and accepts safe URLs", async () => {
    const result = await tool.validateInput!(
      { url: "https://example.com" },
      { abortSignal: new AbortController().signal } as any,
    );
    expect(result.ok).toBe(true);
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
      { url: "https://example.com" },
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
      { url: "https://example.com/text.txt" },
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
      { url: "https://example.com/missing" },
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
      { url: "https://example.com/long" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.result).toContain("[Content truncated due to length...]");
  });

  it("cancels fetch when abort signal is triggered", async () => {
    const abortController = new AbortController();

    globalThis.fetch = (async (_url: any, init?: any) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Aborted"));
        });
      });
    }) as any;

    const executePromise = tool.execute(
      "call-abort",
      { url: "https://example.com" },
      { abortSignal: abortController.signal } as any,
    );

    setTimeout(() => abortController.abort(), 10);

    await expect(executePromise).rejects.toThrow();
  });

  it("times out fetch after configured duration", async () => {
    const originalTimeout = __testConfig.fetchTimeoutMs;
    __testConfig.fetchTimeoutMs = 50;

    try {
      globalThis.fetch = (async (_url: any, init?: any) => {
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
          { url: "https://example.com" },
          { abortSignal: new AbortController().signal } as any,
        ),
      ).rejects.toThrow();

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThanOrEqual(500);
    } finally {
      __testConfig.fetchTimeoutMs = originalTimeout;
    }
  });

  it("propagates network errors", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as any;

    await expect(
      tool.execute(
        "call-network-error",
        { url: "https://example.com" },
        { abortSignal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow("Failed to fetch URL");
  });

  it("upgrades http to https", async () => {
    globalThis.fetch = (async (url: any) => {
      expect(url.toString()).toStartWith("https://");
      return new Response("OK", {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
      });
    }) as any;

    const output = await tool.execute(
      "call-upgrade",
      { url: "http://example.com" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.url).toStartWith("https://");
  });

  it("throws when content exceeds 5MB", async () => {
    const largeContent = new Uint8Array(6 * 1024 * 1024); // 6MB
    globalThis.fetch = (async () =>
      new Response(largeContent, {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
      })) as any;

    await expect(
      tool.execute(
        "call-large",
        { url: "https://example.com/large" },
        { abortSignal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow("Content too large");
  });

  it("throws immediately when abortSignal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("OK");
    }) as any;

    await expect(
      tool.execute(
        "call-pre-aborted",
        { url: "https://example.com" },
        { abortSignal: abortController.signal } as any,
      ),
    ).rejects.toThrow("Aborted");

    expect(fetchCalled).toBe(false);
  });

  it("handles redirects with validation", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: any) => {
      callCount++;
      if (callCount === 1) {
        return new Response("Redirecting", {
          status: 302,
          statusText: "Found",
          headers: new Headers({ location: "https://example.com/redirected" }),
        });
      }
      return new Response("Final content", {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
      });
    }) as any;

    const output = await tool.execute(
      "call-redirect",
      { url: "https://example.com" },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.result).toBe("Final content");
    expect(callCount).toBe(2);
  });

  it("rejects redirect to unsafe URL", async () => {
    globalThis.fetch = (async () =>
      new Response("Redirecting", {
        status: 302,
        statusText: "Found",
        headers: new Headers({ location: "http://localhost:3000" }),
      })) as any;

    await expect(
      tool.execute(
        "call-unsafe-redirect",
        { url: "https://example.com" },
        { abortSignal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow("Redirect to unsafe URL blocked");
  });

  it("sanitizes error messages", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("getaddrinfo ENOTFOUND internal-host.corp.local");
    }) as any;

    await expect(
      tool.execute(
        "call-error-sanitize",
        { url: "https://example.com" },
        { abortSignal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow("Failed to fetch URL");
  });

  it("returns correct formatResult structure", () => {
    const toolInstance = createWebFetchTool();
    const result = toolInstance.formatResult!(
      { url: "https://example.com", code: 200, codeText: "OK", bytes: 100, result: "Hello", durationMs: 50 },
      "tool-call-id",
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual({ type: "text", text: "Hello" });
  });
});
