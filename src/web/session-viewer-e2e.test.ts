// src/web/session-viewer-e2e.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebServer, stopWebServer } from "./index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  HeaderEntry,
  UserEntry,
  AssistantEntry,
} from "../session/entry-types.js";
import type {
  SessionListItem,
  SessionDetailResponse,
} from "./session-api.js";

/** 创建测试用的临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-e2e-test-"));
}

/** 创建测试 session 文件 */
function createTestSession(
  dir: string,
  fileName: string,
  entries: unknown[]
): string {
  const filePath = path.join(dir, fileName);
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("Session Viewer E2E", () => {
  let server: { url: string; stop: () => void };
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.YS_SESSION_DIR;
    tempDir = createTempDir();
    process.env.YS_SESSION_DIR = tempDir;
    server = createWebServer();
  });

  afterEach(() => {
    stopWebServer();
    process.env.YS_SESSION_DIR = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it("GET /health should include sessionDir", async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { sessionDir: string };
    expect(body.sessionDir).toBeDefined();
    expect(typeof body.sessionDir).toBe("string");
    expect(body.sessionDir).toBe(tempDir);
  });

  it("GET /api/sessions should return session list", async () => {
    const header: HeaderEntry = {
      type: "header",
      uuid: "h1",
      parentUuid: null,
      timestamp: 1000,
      version: 1,
      sessionId: "e2e-session",
      cwd: "/tmp",
    };

    createTestSession(tempDir, "1000_e2e-session.jsonl", [header]);

    const res = await fetch(`${server.url}/api/sessions`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionListItem[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].fileName).toBe("1000_e2e-session.jsonl");
    expect(body[0].sessionId).toBe("e2e-session");
  });

  it("GET /api/sessions/:filename should return session detail", async () => {
    const header: HeaderEntry = {
      type: "header",
      uuid: "h1",
      parentUuid: null,
      timestamp: 1000,
      version: 1,
      sessionId: "detail-session",
      cwd: "/tmp",
    };

    const user: UserEntry = {
      type: "user",
      uuid: "u1",
      parentUuid: "h1",
      timestamp: 1001,
      content: "hello",
    };

    const assistant: AssistantEntry = {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp: 1002,
      content: [{ type: "text", text: "hi" }],
      model: "claude",
      usage: {
        input: 10,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
      },
      stopReason: "end_turn",
    };

    createTestSession(tempDir, "detail.jsonl", [header, user, assistant]);

    const res = await fetch(`${server.url}/api/sessions/detail.jsonl`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionDetailResponse;
    expect(body.fileName).toBe("detail.jsonl");
    expect(body.header.sessionId).toBe("detail-session");
    expect(body.entries).toHaveLength(3);
    expect(body.stats.userCount).toBe(1);
    expect(body.stats.assistantCount).toBe(1);
    expect(body.stats.totalTokens).toBe(30);
  });

  it("GET /sessions should return HTML page", async () => {
    const res = await fetch(`${server.url}/sessions`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("Session Viewer");
  });

  it("GET /api/sessions/:filename should return 404 for non-existent file", async () => {
    const res = await fetch(`${server.url}/api/sessions/non-existent.jsonl`);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not Found");
  });

  it("GET /api/sessions/invalid.txt should return 404", async () => {
    const res = await fetch(`${server.url}/api/sessions/invalid.txt`);
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
  });
});
