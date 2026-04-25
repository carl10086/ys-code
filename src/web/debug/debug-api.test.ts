// src/web/debug/debug-api.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleDebugAPI } from "./debug-api.js";
import { setDebugAgentSession } from "./debug-context.js";

// Mock AgentSession
function createMockSession(overrides: Partial<{
  sessionId: string;
  model: { name: string; provider: string };
  isStreaming: boolean;
  pendingToolCalls: Set<string>;
  messages: unknown[];
  tools: { name: string }[];
  getSystemPrompt: () => string;
  convertToLlm: (messages: unknown[]) => unknown[] | Promise<unknown[]>;
}> = {}) {
  return {
    sessionId: overrides.sessionId ?? "test-session-id",
    model: overrides.model ?? { name: "test-model", provider: "test" },
    isStreaming: overrides.isStreaming ?? false,
    pendingToolCalls: overrides.pendingToolCalls ?? new Set(),
    messages: overrides.messages ?? [],
    tools: overrides.tools ?? [],
    getSystemPrompt: overrides.getSystemPrompt ?? (() => "test system prompt"),
    convertToLlm: overrides.convertToLlm ?? ((msgs: unknown[]) => msgs),
  } as any;
}

describe("Debug API", () => {
  beforeEach(() => {
    setDebugAgentSession(undefined);
  });

  afterEach(() => {
    setDebugAgentSession(undefined);
  });

  it("should return 404 when no active session", async () => {
    const req = new Request("http://localhost/api/debug/context");
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No active session");
  });

  it("should return 405 for non-GET requests", async () => {
    const req = new Request("http://localhost/api/debug/context", { method: "POST" });
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(405);
  });

  it("should return debug context for active session", async () => {
    const session = createMockSession({
      sessionId: "sess-123",
      model: { name: "gpt-4", provider: "openai" },
      isStreaming: true,
      pendingToolCalls: new Set(["call-1"]),
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "read" }],
      convertToLlm: (msgs: unknown[]) => msgs.map((m: any) => ({ ...m, _converted: true })),
    });

    setDebugAgentSession(session);

    const req = new Request("http://localhost/api/debug/context");
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe("sess-123");
    expect(body.model.name).toBe("gpt-4");
    expect(body.isStreaming).toBe(true);
    expect(body.pendingToolCalls).toEqual(["call-1"]);
    expect(body.messageCount).toBe(1);
    expect(body.messages).toHaveLength(1);
    expect(body.llmMessages).toHaveLength(1);
    expect(body.llmMessages[0]._converted).toBe(true);
    expect(body.systemPrompt).toBe("test system prompt");
    expect(body.toolNames).toEqual(["read"]);
    expect(body.timestamp).toBeNumber();
  });

  it("should return 404 for unknown debug subpath", async () => {
    const session = createMockSession();
    setDebugAgentSession(session);

    const req = new Request("http://localhost/api/debug/unknown");
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(404);
  });
});
