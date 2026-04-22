import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SessionStorage } from "./session-storage.js";
import type { UserEntry } from "./entry-types.js";

describe("SessionStorage", () => {
  let tmpDir: string;
  let storage: SessionStorage;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "session-test-"));
    storage = new SessionStorage(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("应创建新会话文件并写入 header", () => {
    const sessionId = "test-session";
    const filePath = storage.createSession(sessionId, "/tmp/cwd");
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const header = JSON.parse(lines[0]);
    expect(header.type).toBe("header");
    expect(header.sessionId).toBe(sessionId);
    expect(header.cwd).toBe("/tmp/cwd");
    expect(header.version).toBe(1);
  });

  it("应追加条目到会话文件", () => {
    const sessionId = "test-session";
    const filePath = storage.createSession(sessionId, "/tmp/cwd");

    const entry: UserEntry = {
      type: "user",
      uuid: "msg-1",
      parentUuid: "hdr-1",
      timestamp: 1000,
      content: "Hello",
    };
    storage.appendEntry(filePath, entry);

    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    const parsed = JSON.parse(lines[1]);
    expect(parsed.type).toBe("user");
    expect(parsed.content).toBe("Hello");
  });

  it("应读取所有条目", () => {
    const sessionId = "test-session";
    const filePath = storage.createSession(sessionId, "/tmp/cwd");

    storage.appendEntry(filePath, { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1000, content: "Hello" } as UserEntry);
    storage.appendEntry(filePath, { type: "user", uuid: "msg-2", parentUuid: "msg-1", timestamp: 1001, content: "World" } as UserEntry);

    const entries = storage.readAllEntries(filePath);
    expect(entries.length).toBe(3); // header + 2 messages
    expect(entries[0].type).toBe("header");
    expect((entries[1] as UserEntry).content).toBe("Hello");
    expect((entries[2] as UserEntry).content).toBe("World");
  });

  it("损坏的行应被跳过", () => {
    const sessionId = "test-session";
    const filePath = storage.createSession(sessionId, "/tmp/cwd");
    fs.appendFileSync(filePath, "this is not json\n", { encoding: "utf-8" });
    storage.appendEntry(filePath, { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1000, content: "Hello" } as UserEntry);

    const entries = storage.readAllEntries(filePath);
    expect(entries.length).toBe(2); // header + valid message, corrupted line skipped
  });

  it("应找到最近的会话文件", () => {
    storage.createSession("session-1", "/tmp/cwd");
    const filePath2 = storage.createSession("session-2", "/tmp/cwd");

    const latest = storage.findLatestSessionFile();
    expect(latest).toBe(filePath2);
  });
});
