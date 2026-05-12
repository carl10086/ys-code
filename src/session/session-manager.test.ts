import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SessionManager } from "./session-manager.js";
import type { AgentMessage } from "../agent/types.js";
import "../agent/attachments/types.js";
import type { AttachmentEntry } from "./entry-types.js";

describe("SessionManager", () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "sm-test-"));
    manager = new SessionManager({ baseDir: tmpDir, cwd: "/projects/ys-code" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("应初始化并创建新会话", () => {
    expect(manager.sessionId).toBeDefined();
    expect(manager.sessionId.length).toBeGreaterThan(0);
  });

  it("应追加消息并持久化", () => {
    const msg: AgentMessage = { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: Date.now() };
    manager.appendMessage(msg);

    // 验证能恢复
    const restored = manager.restoreMessages();
    expect(restored.length).toBe(1);
    expect(restored[0].role).toBe("user");
  });

  it("应恢复之前创建的会话", () => {
    const msg1: AgentMessage = { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: Date.now() };
    const msg2: AgentMessage = { role: "assistant", content: [{ type: "text", text: "Hi" }], api: "anthropic-messages", provider: "anthropic", model: "claude-test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
    manager.appendMessage(msg1);
    manager.appendMessage(msg2);

    // 用 restoreLatest 恢复最近会话
    const restoredManager = SessionManager.restoreLatest({ baseDir: tmpDir, cwd: "/projects/ys-code" });
    expect(restoredManager).not.toBeNull();
    const latestMessages = restoredManager!.restoreMessages();
    expect(latestMessages.length).toBe(2);
    expect(latestMessages[0].role).toBe("user");
    expect(latestMessages[1].role).toBe("assistant");
  });

  it("replaceMessages 应追加 compact 后消息而不删除旧 transcript", () => {
    const oldMessage: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "old history" }],
      timestamp: 1000,
    };
    manager.appendMessage(oldMessage);

    manager.replaceMessages([
      {
        role: "compact_boundary",
        uuid: "compact-1",
        parentUuid: null,
        timestamp: 1001,
        compactMetadata: { trigger: "manual", preTokens: 100 },
      } as AgentMessage,
      {
        role: "user",
        isMeta: true,
        content: [{ type: "text", text: "Summary" }],
        timestamp: 1002,
      },
      {
        role: "user",
        content: [{ type: "text", text: "/compact" }],
        timestamp: 1003,
      },
    ]);

    const entries = (manager as any).storage.readAllEntries(manager.filePath);
    expect(JSON.stringify(entries)).toContain("old history");
    expect(entries.some((entry: any) => entry.type === "compact_boundary" && entry.uuid === "compact-1")).toBe(true);

    const restored = manager.restoreMessages();
    expect(restored).toHaveLength(3);
    expect(restored[0].role).toBe("compact_boundary");
    expect((restored[1] as any).content[0].text).toBe("Summary");
    expect((restored[2] as any).content[0].text).toBe("/compact");
    expect(JSON.stringify(restored)).not.toContain("old history");
  });

  it("restoreMessages should start from the latest structured compact boundary after multiple compactions", () => {
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "old history" }],
      timestamp: 1000,
    });

    manager.replaceMessages([
      {
        role: "compact_boundary",
        uuid: "compact-1",
        parentUuid: null,
        timestamp: 1001,
        compactMetadata: { trigger: "manual", preTokens: 100 },
      } as AgentMessage,
      {
        role: "user",
        isMeta: true,
        content: [{ type: "text", text: "first summary" }],
        timestamp: 1002,
      },
    ]);
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "between compacts" }],
      timestamp: 1003,
    });
    manager.replaceMessages([
      {
        role: "compact_boundary",
        uuid: "compact-2",
        parentUuid: null,
        timestamp: 1004,
        compactMetadata: { trigger: "manual", preTokens: 50 },
      } as AgentMessage,
      {
        role: "user",
        isMeta: true,
        content: [{ type: "text", text: "second summary" }],
        timestamp: 1005,
      },
    ]);

    const restored = manager.restoreMessages();
    expect(restored).toHaveLength(2);
    expect((restored[0] as any).uuid).toBe("compact-2");
    expect((restored[1] as any).content[0].text).toBe("second summary");
    expect(JSON.stringify(restored)).not.toContain("first summary");
    expect(JSON.stringify(restored)).not.toContain("between compacts");
  });
});

describe("SessionManager attachment support", () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "sm-attach-test-"));
    manager = new SessionManager({ baseDir: tmpDir, cwd: process.cwd() });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should persist and restore attachment message", () => {
    const message: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Available skills: read, write",
        skillNames: ["read", "write"],
        timestamp: 1234567890,
      },
      timestamp: 1234567890,
    } as AgentMessage;

    manager.appendMessage(message);

    const entries = (manager as any).storage.readAllEntries(manager.filePath);
    const attachmentEntry = entries.find((e: any): e is AttachmentEntry => e.type === "attachment");

    expect(attachmentEntry).toBeDefined();
    expect(attachmentEntry.attachmentType).toBe("skill_listing");

    // restore 应返回 attachment
    const restored = manager.restoreMessages();
    expect(restored.length).toBe(1);
    expect(restored[0].role).toBe("attachment");
    expect((restored[0] as any).attachment.skillNames).toEqual(["read", "write"]);
  });

  it("should persist and restore file attachment", () => {
    const message: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "file",
        filePath: "/test/file.ts",
        content: { type: "text", text: "export const x = 1;" },
        displayPath: "test/file.ts",
        timestamp: 1234567890,
      },
      timestamp: 1234567890,
    } as AgentMessage;

    manager.appendMessage(message);

    const entries = (manager as any).storage.readAllEntries(manager.filePath);
    const attachmentEntry = entries.find((e: any): e is AttachmentEntry => e.type === "attachment");

    expect(attachmentEntry).toBeDefined();
    expect(attachmentEntry.attachmentType).toBe("file");

    // restore 应返回 attachment
    const restored = manager.restoreMessages();
    expect(restored.length).toBe(1);
    expect(restored[0].role).toBe("attachment");
    expect((restored[0] as any).attachment.filePath).toBe("/test/file.ts");
  });
});
