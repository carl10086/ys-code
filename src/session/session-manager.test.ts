import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SessionManager } from "./session-manager.js";
import type { AgentMessage } from "../agent/types.js";

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
});
