// src/web/debug-inspector-e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebServer, stopWebServer } from "./index.js";
import { setDebugAgentSession } from "./debug/debug-context.js";

describe("Debug Inspector E2E", () => {
  beforeEach(() => {
    setDebugAgentSession(undefined);
  });

  afterEach(() => {
    stopWebServer();
    setDebugAgentSession(undefined);
  });

  it("should serve debug page", async () => {
    const server = createWebServer();

    const res = await fetch(`${server.url}/debug`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("Debug Inspector");
  });

  it("should return 404 when no session for context API", async () => {
    const server = createWebServer();

    const res = await fetch(`${server.url}/api/debug/context`);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("No active session");
  });

  it("should return context when session is registered", async () => {
    const server = createWebServer();

    const mockSession = {
      sessionId: "e2e-test-session",
      model: { name: "test-model", provider: "test" },
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      getSystemPrompt: () => "test prompt",
      convertToLlm: (msgs: unknown[]) => msgs,
    } as any;

    setDebugAgentSession(mockSession);

    const res = await fetch(`${server.url}/api/debug/context`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.sessionId).toBe("e2e-test-session");
    expect(body.messageCount).toBe(1);
  });

  it("should include debug link on home page", async () => {
    const server = createWebServer();

    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/debug");
  });
});
