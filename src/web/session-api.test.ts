// src/web/session-api.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getSessionDir,
  listSessions,
  getSession,
  handleSessionAPI,
  FileTooLargeError,
  type SessionListItem,
  type SessionDetailResponse,
} from "./session-api.js";
import type { HeaderEntry, UserEntry, AssistantEntry, CompactBoundaryEntry } from "../session/entry-types.js";

/** 创建测试用的临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-api-test-"));
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

describe("Session API", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.YS_SESSION_DIR;
    tempDir = createTempDir();
    process.env.YS_SESSION_DIR = tempDir;
  });

  afterEach(() => {
    process.env.YS_SESSION_DIR = originalEnv;
    // 清理临时目录
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe("getSessionDir", () => {
    it("should return YS_SESSION_DIR when set", () => {
      expect(getSessionDir()).toBe(tempDir);
    });

    it("should return default path when YS_SESSION_DIR is not set", () => {
      delete process.env.YS_SESSION_DIR;
      const expected = path.join(os.homedir(), ".ys-code", "sessions");
      expect(getSessionDir()).toBe(expected);
    });
  });

  describe("listSessions", () => {
    it("should return empty array when directory does not exist", () => {
      process.env.YS_SESSION_DIR = path.join(tempDir, "nonexistent");
      expect(listSessions()).toEqual([]);
    });

    it("should return empty array when no .jsonl files", () => {
      fs.writeFileSync(path.join(tempDir, "readme.txt"), "hello");
      expect(listSessions()).toEqual([]);
    });

    it("should return session list with correct stats", () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "session-1",
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

      createTestSession(tempDir, "1000_session-1.jsonl", [header, user, assistant]);

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].fileName).toBe("1000_session-1.jsonl");
      expect(sessions[0].sessionId).toBe("session-1");
      expect(sessions[0].createdAt).toBe(1000);
      expect(sessions[0].entryCount).toBe(3);
      expect(sessions[0].messageCount).toBe(2);
      expect(sessions[0].hasCompact).toBe(false);
    });

    it("should detect compact_boundary", () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "session-compact",
        cwd: "/tmp",
      };

      const compact: CompactBoundaryEntry = {
        type: "compact_boundary",
        uuid: "c1",
        parentUuid: "a1",
        timestamp: 1003,
        summary: "summary",
        tokensBefore: 100,
        tokensAfter: 50,
      };

      createTestSession(tempDir, "1000_session-compact.jsonl", [header, compact]);

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].hasCompact).toBe(true);
    });

    it("should sort sessions by createdAt descending", () => {
      const header1: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "older",
        cwd: "/tmp",
      };

      const header2: HeaderEntry = {
        type: "header",
        uuid: "h2",
        parentUuid: null,
        timestamp: 2000,
        version: 1,
        sessionId: "newer",
        cwd: "/tmp",
      };

      createTestSession(tempDir, "1000_older.jsonl", [header1]);
      createTestSession(tempDir, "2000_newer.jsonl", [header2]);

      const sessions = listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe("newer");
      expect(sessions[1].sessionId).toBe("older");
    });
  });

  describe("getSession", () => {
    it("should return session detail for valid file", () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "session-1",
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

      createTestSession(tempDir, "1000_session-1.jsonl", [header, user, assistant]);

      const detail = getSession("1000_session-1.jsonl");
      expect(detail).not.toBeNull();
      expect(detail!.fileName).toBe("1000_session-1.jsonl");
      expect(detail!.header.sessionId).toBe("session-1");
      expect(detail!.entries).toHaveLength(3);
      expect(detail!.stats.userCount).toBe(1);
      expect(detail!.stats.assistantCount).toBe(1);
      expect(detail!.stats.totalTokens).toBe(30);
    });

    it("should return null for non-existent file", () => {
      const detail = getSession("nonexistent.jsonl");
      expect(detail).toBeNull();
    });

    it("should reject filenames with ..", () => {
      const detail = getSession("../etc/passwd.jsonl");
      expect(detail).toBeNull();
    });

    it("should reject filenames with /", () => {
      const detail = getSession("foo/bar.jsonl");
      expect(detail).toBeNull();
    });

    it("should reject filenames with \\", () => {
      const detail = getSession("foo\\bar.jsonl");
      expect(detail).toBeNull();
    });

    it("should reject filenames without .jsonl extension", () => {
      const detail = getSession("session.txt");
      expect(detail).toBeNull();
    });

    it("should throw FileTooLargeError for oversized files", () => {
      // 创建一个超过 50MB 的文件
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "big",
        cwd: "/tmp",
      };

      const filePath = path.join(tempDir, "big.jsonl");
      const bigLine = "x".repeat(1024 * 1024); // 1MB per line
      const lines = 51; // 51MB total

      const content = JSON.stringify(header) + "\n";
      fs.writeFileSync(filePath, content, "utf-8");

      for (let i = 0; i < lines; i++) {
        fs.appendFileSync(filePath, bigLine + "\n", "utf-8");
      }

      expect(() => getSession("big.jsonl")).toThrow(FileTooLargeError);
    });

    it("should handle corrupted lines gracefully", () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "session-corrupt",
        cwd: "/tmp",
      };

      const filePath = path.join(tempDir, "corrupt.jsonl");
      fs.writeFileSync(
        filePath,
        JSON.stringify(header) + "\nthis is not json\n",
        "utf-8"
      );

      const detail = getSession("corrupt.jsonl");
      expect(detail).not.toBeNull();
      expect(detail!.entries).toHaveLength(1);
      expect(detail!.header.sessionId).toBe("session-corrupt");
    });
  });

  describe("handleSessionAPI", () => {
    it("should return session list for GET /api/sessions", async () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "session-1",
        cwd: "/tmp",
      };

      createTestSession(tempDir, "1000_session-1.jsonl", [header]);

      const req = new Request("http://localhost/api/sessions");
      const res = handleSessionAPI(req);

      expect(res.status).toBe(200);
      const body = await res.json() as SessionListItem[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].sessionId).toBe("session-1");
    });

    it("should return session detail for GET /api/sessions/:filename", async () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "session-1",
        cwd: "/tmp",
      };

      const user: UserEntry = {
        type: "user",
        uuid: "u1",
        parentUuid: "h1",
        timestamp: 1001,
        content: "hello",
      };

      createTestSession(tempDir, "1000_session-1.jsonl", [header, user]);

      const req = new Request("http://localhost/api/sessions/1000_session-1.jsonl");
      const res = handleSessionAPI(req);

      expect(res.status).toBe(200);
      const body = await res.json() as SessionDetailResponse;
      expect(body.fileName).toBe("1000_session-1.jsonl");
      expect(body.header.sessionId).toBe("session-1");
      expect(body.entries).toHaveLength(2);
    });

    it("should return 404 for non-existent session", async () => {
      const req = new Request("http://localhost/api/sessions/nonexistent.jsonl");
      const res = handleSessionAPI(req);

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Not Found");
    });

    it("should return 405 for non-GET methods", async () => {
      const req = new Request("http://localhost/api/sessions", { method: "POST" });
      const res = handleSessionAPI(req);

      expect(res.status).toBe(405);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Method Not Allowed");
    });

    it("should return 400/404 for path traversal attempt", async () => {
      const req = new Request("http://localhost/api/sessions/../etc/passwd.jsonl");
      const res = handleSessionAPI(req);

      // 文件名校验会拒绝 ..，返回 null，然后转为 404
      expect(res.status).toBe(404);
    });

    it("should return 413 for oversized files", async () => {
      const header: HeaderEntry = {
        type: "header",
        uuid: "h1",
        parentUuid: null,
        timestamp: 1000,
        version: 1,
        sessionId: "big",
        cwd: "/tmp",
      };

      const filePath = path.join(tempDir, "big.jsonl");
      fs.writeFileSync(filePath, JSON.stringify(header) + "\n", "utf-8");

      const bigLine = "x".repeat(1024 * 1024);
      for (let i = 0; i < 51; i++) {
        fs.appendFileSync(filePath, bigLine + "\n", "utf-8");
      }

      const req = new Request("http://localhost/api/sessions/big.jsonl");
      const res = handleSessionAPI(req);

      expect(res.status).toBe(413);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Payload Too Large");
    });
  });
});
