import { describe, it, expect } from "bun:test";
import { SessionLoader } from "./session-loader.js";
import { SessionManager } from "./session-manager.js";
import type { Entry } from "./entry-types.js";
import type { AgentMessage } from "../agent/types.js";
import { tmpdir } from "os";

describe("SessionLoader", () => {
  const loader = new SessionLoader();

  it("空条目应返回空消息", () => {
    const result = loader.restoreMessages([]);
    expect(result).toEqual([]);
  });

  it("应恢复普通消息链", () => {
    const entries: Entry[] = [
      { type: "header", uuid: "hdr-1", parentUuid: null, timestamp: 1000, version: 1, sessionId: "s1", cwd: "/tmp" },
      { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1001, content: "Hello" },
      { type: "assistant", uuid: "msg-2", parentUuid: "msg-1", timestamp: 1002, content: [{ type: "text", text: "Hi" }], model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, stopReason: "stop" },
    ];

    const messages = loader.restoreMessages(entries);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect((messages[0] as any).content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
  });

  it("应处理 compact_boundary", () => {
    const entries: Entry[] = [
      { type: "header", uuid: "hdr-1", parentUuid: null, timestamp: 1000, version: 1, sessionId: "s1", cwd: "/tmp" },
      { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1001, content: "Hello" },
      { type: "compact_boundary", uuid: "compact-1", parentUuid: "msg-1", timestamp: 1002, summary: "Summary text", tokensBefore: 100, tokensAfter: 10 },
      { type: "user", uuid: "msg-2", parentUuid: "compact-1", timestamp: 1003, content: "After compact" },
    ];

    const messages = loader.restoreMessages(entries);
    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe("user");
    expect((messages[1] as any).role).toBe("system");
    expect((messages[1] as any).content).toEqual([{ type: "text", text: "Summary text" }]);
    expect(messages[2].role).toBe("user");
    expect((messages[2] as any).content).toBe("After compact");
  });

  it("新版 compact_boundary 应从 boundary 开始恢复 active context", () => {
    const entries: Entry[] = [
      { type: "header", uuid: "hdr-1", parentUuid: null, timestamp: 1000, version: 1, sessionId: "s1", cwd: "/tmp" },
      { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1001, content: "Old history" },
      {
        type: "compact_boundary",
        uuid: "compact-1",
        parentUuid: "msg-1",
        timestamp: 1002,
        summary: "",
        tokensBefore: 100,
        tokensAfter: 10,
        compactMetadata: {
          trigger: "manual",
          preTokens: 100,
          clearedToolCallIds: ["tool-1"],
        },
      },
      { type: "user", uuid: "summary-1", parentUuid: "compact-1", timestamp: 1003, content: [{ type: "text", text: "Summary" }], isMeta: true },
      { type: "user", uuid: "cmd-1", parentUuid: "summary-1", timestamp: 1004, content: [{ type: "text", text: "/compact" }] },
    ];

    const messages = loader.restoreMessages(entries);
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("compact_boundary");
    expect((messages[0] as any).uuid).toBe("compact-1");
    expect((messages[0] as any).compactMetadata.clearedToolCallIds).toEqual(["tool-1"]);
    expect((messages[1] as any).content[0].text).toBe("Summary");
    expect(JSON.stringify(messages)).not.toContain("Old history");
  });

  it("应从叶子节点回走构建活跃分支", () => {
    const entries: Entry[] = [
      { type: "header", uuid: "hdr-1", parentUuid: null, timestamp: 1000, version: 1, sessionId: "s1", cwd: "/tmp" },
      { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1001, content: "Hello" },
      { type: "assistant", uuid: "msg-2", parentUuid: "msg-1", timestamp: 1002, content: [{ type: "text", text: "Hi" }], model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, stopReason: "stop" },
      { type: "user", uuid: "msg-3", parentUuid: "msg-2", timestamp: 1003, content: "Fork" },
    ];

    const messages = loader.restoreMessages(entries);
    expect(messages.length).toBe(3);
    expect((messages[messages.length - 1] as any).content).toBe("Fork");
  });
});

describe("SessionLoader attachment support", () => {
  it("should restore attachment entry to AgentMessage", () => {
    const loader = new SessionLoader();
    const entries: Entry[] = [
      {
        type: "attachment",
        uuid: "uuid-1",
        parentUuid: null,
        timestamp: 1234567890,
        attachmentType: "skill_listing",
        content: '{"type":"skill_listing","content":"skills","skillNames":["read"],"timestamp":1234567890}',
      },
    ];

    const messages = loader.restoreMessages(entries);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("attachment");
    expect((messages[0] as any).attachment.type).toBe("skill_listing");
    expect((messages[0] as any).attachment.skillNames).toEqual(["read"]);
  });

  it("should restore persisted attachment", () => {
    const baseDir = tmpdir();
    const manager = new SessionManager({ baseDir, cwd: process.cwd() });
    const originalMessage: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "directory",
        path: "/test/dir",
        content: "file1.ts\nfile2.ts",
        displayPath: "test/dir",
        timestamp: 1234567890,
      },
      timestamp: 1234567890,
    } as unknown as AgentMessage;

    manager.appendMessage(originalMessage);

    // attachment 应被持久化并恢复
    const restoredMessages = manager.restoreMessages();
    expect(restoredMessages).toHaveLength(1);
    expect(restoredMessages[0].role).toBe("attachment");
    expect((restoredMessages[0] as any).attachment.type).toBe("directory");
  });
});
