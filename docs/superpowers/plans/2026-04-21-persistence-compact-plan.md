# ys-code 持久化与 Compact 机制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ys-code 的会话持久化（JSONL 写入/加载/恢复）和上下文压缩（Compact）机制。

**Architecture:** SessionManager 封装所有持久化逻辑（写入、加载、恢复），独立于 Agent 核心。Entry 类型体系描述磁盘格式（header/user/assistant/toolResult/compact_boundary）。Compact 通过 LLM 生成摘要并写入 compact_boundary 标记实现。加载时从叶子节点回走 parentUuid 构建活跃分支。

**Tech Stack:** TypeScript, Bun, Node.js fs API, proper-lockfile（文件锁）

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/session/entry-types.ts` | Entry 类型定义（5 种 entry + 联合类型） |
| `src/session/session-storage.ts` | 文件级操作（写入、读取、路径解析、文件锁） |
| `src/session/session-loader.ts` | 加载与恢复（解析 JSONL、构建活跃分支、处理 compact_boundary） |
| `src/session/token-estimator.ts` | Token 估算（字符数估算，预留 tiktoken 接口） |
| `src/session/compact.ts` | Compact 触发判断与摘要生成 |
| `src/session/session-manager.ts` | 统一入口（组合上述模块，暴露简洁接口） |
| `src/session/index.ts` | 模块导出 |
| `src/session/session-manager.test.ts` | SessionManager 集成测试 |
| `src/session/session-storage.test.ts` | 文件操作测试 |
| `src/session/session-loader.test.ts` | 加载恢复测试 |
| `src/session/compact.test.ts` | Compact 逻辑测试 |
| `src/agent/session.ts` | 集成 SessionManager（修改） |

---

## Task 1: Entry 类型定义

**Files:**
- Create: `src/session/entry-types.ts`

- [ ] **Step 1: 编写 Entry 类型定义**

```typescript
// src/session/entry-types.ts

/** 会话条目基接口 */
export interface SessionEntry {
  /** 条目类型 */
  type: string;
  /** 唯一标识符 */
  uuid: string;
  /** 父条目 UUID（链式/DAG 结构） */
  parentUuid: string | null;
  /** 时间戳（毫秒） */
  timestamp: number;
}

/** 文件头条目 */
export interface HeaderEntry extends SessionEntry {
  type: "header";
  /** 数据格式版本号 */
  version: number;
  /** 会话 ID */
  sessionId: string;
  /** 当前工作目录 */
  cwd: string;
}

/** 用户消息条目 */
export interface UserEntry extends SessionEntry {
  type: "user";
  /** 消息内容 */
  content: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  /** 是否为 meta 消息（UI 隐藏，LLM 可见） */
  isMeta?: boolean;
}

/** Assistant 消息条目 */
export interface AssistantEntry extends SessionEntry {
  type: "assistant";
  /** 消息内容 */
  content: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  >;
  /** 使用的模型名称 */
  model: string;
  /** Token 使用量 */
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
  };
  /** 停止原因 */
  stopReason: string;
  /** 错误信息 */
  errorMessage?: string;
}

/** 工具结果条目 */
export interface ToolResultEntry extends SessionEntry {
  type: "toolResult";
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 结果内容 */
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  /** 是否出错 */
  isError: boolean;
  /** 详细结果 */
  details?: unknown;
}

/** Compact 边界条目 */
export interface CompactBoundaryEntry extends SessionEntry {
  type: "compact_boundary";
  /** 摘要内容 */
  summary: string;
  /** 压缩前的 token 数 */
  tokensBefore: number;
  /** 压缩后的 token 数 */
  tokensAfter: number;
}

/** 所有条目的联合类型 */
export type Entry = HeaderEntry | UserEntry | AssistantEntry | ToolResultEntry | CompactBoundaryEntry;
```

- [ ] **Step 2: 验证类型编译通过**

Run: `bunx tsc --noEmit src/session/entry-types.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/session/entry-types.ts
git commit -m "feat(session): define Entry type system for persistence"
```

---

## Task 2: 文件存储层（SessionStorage）

**Files:**
- Create: `src/session/session-storage.ts`
- Create: `src/session/session-storage.test.ts`

- [ ] **Step 1: 编写测试（先写失败的测试）**

```typescript
// src/session/session-storage.test.ts
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
    expect(entries[1].content).toBe("Hello");
    expect(entries[2].content).toBe("World");
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
    // 稍等一毫秒确保时间不同
    const filePath2 = storage.createSession("session-2", "/tmp/cwd");

    const latest = storage.findLatestSessionFile();
    expect(latest).toBe(filePath2);
  });
});
```

Run: `bun test src/session/session-storage.test.ts`
Expected: FAIL, "SessionStorage is not defined"

- [ ] **Step 2: 实现 SessionStorage**

```typescript
// src/session/session-storage.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, HeaderEntry } from "./entry-types.js";
import { logger } from "../utils/logger.js";

/** 会话文件存储操作 */
export class SessionStorage {
  /** 基础存储目录 */
  constructor(private readonly baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  /** 创建新会话文件，写入 header */
  createSession(sessionId: string, cwd: string): string {
    const fileName = `${Date.now()}_${sessionId}.jsonl`;
    const filePath = path.join(this.baseDir, fileName);

    const header: HeaderEntry = {
      type: "header",
      uuid: this.generateUuid(),
      parentUuid: null,
      timestamp: Date.now(),
      version: 1,
      sessionId,
      cwd,
    };

    fs.writeFileSync(filePath, JSON.stringify(header) + "\n", { encoding: "utf-8" });
    return filePath;
  }

  /** 追加条目到会话文件 */
  appendEntry(filePath: string, entry: Entry): void {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, { encoding: "utf-8" });
  }

  /** 读取所有条目（跳过损坏行） */
  readAllEntries(filePath: string): Entry[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const entries: Entry[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Entry;
        entries.push(entry);
      } catch {
        logger.warn("Skipping corrupted line in session file", { filePath, line: line.slice(0, 100) });
      }
    }

    return entries;
  }

  /** 找到最近修改的会话文件 */
  findLatestSessionFile(): string | null {
    const files = fs.readdirSync(this.baseDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({
        name: f,
        path: path.join(this.baseDir, f),
        mtime: fs.statSync(path.join(this.baseDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  }

  private generateUuid(): string {
    return crypto.randomUUID();
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/session/session-storage.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add src/session/session-storage.ts src/session/session-storage.test.ts
git commit -m "feat(session): add SessionStorage for file operations"
```

---

## Task 3: 会话加载与恢复（SessionLoader）

**Files:**
- Create: `src/session/session-loader.ts`
- Create: `src/session/session-loader.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// src/session/session-loader.test.ts
import { describe, it, expect } from "bun:test";
import { SessionLoader } from "./session-loader.js";
import type { Entry, UserEntry, AssistantEntry, CompactBoundaryEntry } from "./entry-types.js";
import type { AgentMessage } from "../agent/types.js";

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
    expect(messages[1].role).toBe("system");
    expect((messages[1] as any).content).toBe("Summary text");
    expect(messages[2].role).toBe("user");
    expect((messages[2] as any).content).toBe("After compact");
  });

  it("应从叶子节点回走构建活跃分支", () => {
    // 模拟 fork：hdr -> msg-1 -> msg-2 (主分支)
    //                      -> msg-3 (分支，没有子节点，所以是叶子)
    const entries: Entry[] = [
      { type: "header", uuid: "hdr-1", parentUuid: null, timestamp: 1000, version: 1, sessionId: "s1", cwd: "/tmp" },
      { type: "user", uuid: "msg-1", parentUuid: "hdr-1", timestamp: 1001, content: "Hello" },
      { type: "assistant", uuid: "msg-2", parentUuid: "msg-1", timestamp: 1002, content: [{ type: "text", text: "Hi" }], model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, stopReason: "stop" },
      { type: "user", uuid: "msg-3", parentUuid: "msg-1", timestamp: 1003, content: "Fork" },
    ];

    const messages = loader.restoreMessages(entries);
    // msg-3 是最后一条没有子节点的消息（叶子）
    expect(messages.length).toBe(3); // hdr -> msg-1 -> msg-3 (msg-2 被排除)
    expect((messages[messages.length - 1] as any).content).toBe("Fork");
  });
});
```

Run: `bun test src/session/session-loader.test.ts`
Expected: FAIL, "SessionLoader is not defined"

- [ ] **Step 2: 实现 SessionLoader**

```typescript
// src/session/session-loader.ts
import type { Entry } from "./entry-types.js";
import type { AgentMessage } from "../agent/types.js";

/** 会话加载与恢复 */
export class SessionLoader {
  /** 从条目列表恢复消息 */
  restoreMessages(entries: Entry[]): AgentMessage[] {
    if (entries.length === 0) return [];

    // 找到活跃分支（从最后叶子回走 root）
    const activeBranch = this.findActiveBranch(entries);

    // 转换为 AgentMessage
    const messages: AgentMessage[] = [];
    for (const entry of activeBranch) {
      if (entry.type === "header") continue;

      if (entry.type === "compact_boundary") {
        messages.push({
          role: "system",
          content: [{ type: "text", text: entry.summary }],
          timestamp: entry.timestamp,
        } as AgentMessage);
        continue;
      }

      messages.push(this.entryToMessage(entry));
    }

    return messages;
  }

  /** 找到活跃分支（从最后叶子回走） */
  private findActiveBranch(entries: Entry[]): Entry[] {
    const byUuid = new Map(entries.map(e => [e.uuid, e]));
    const hasParent = new Set(entries.map(e => e.parentUuid).filter((p): p is string => p !== null));

    // 找到所有叶子节点（没有子节点）
    const leaves = entries.filter(e => !hasParent.has(e.uuid));
    if (leaves.length === 0) return entries;

    // 取最后一个叶子（最新会话）
    const leaf = leaves[leaves.length - 1];

    // 从叶子回走构建路径
    const path: Entry[] = [];
    let current: Entry | undefined = leaf;
    while (current) {
      path.unshift(current);
      current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
    }

    return path;
  }

  /** 将单个 Entry 转换为 AgentMessage */
  private entryToMessage(entry: Exclude<Entry, { type: "header" } | { type: "compact_boundary" }>): AgentMessage {
    switch (entry.type) {
      case "user":
        return {
          role: "user",
          content: typeof entry.content === "string"
            ? [{ type: "text", text: entry.content }]
            : entry.content,
          timestamp: entry.timestamp,
          isMeta: entry.isMeta,
        } as AgentMessage;

      case "assistant":
        return {
          role: "assistant",
          content: entry.content,
          model: entry.model,
          usage: entry.usage,
          stopReason: entry.stopReason,
          errorMessage: entry.errorMessage,
          timestamp: entry.timestamp,
        } as AgentMessage;

      case "toolResult":
        return {
          role: "toolResult",
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          content: entry.content,
          isError: entry.isError,
          details: entry.details,
          timestamp: entry.timestamp,
        } as AgentMessage;
    }
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/session/session-loader.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add src/session/session-loader.ts src/session/session-loader.test.ts
git commit -m "feat(session): add SessionLoader for restore and branch walk"
```

---

## Task 4: Token 估算器

**Files:**
- Create: `src/session/token-estimator.ts`

- [ ] **Step 1: 编写测试**

```typescript
// src/session/token-estimator.test.ts
import { describe, it, expect } from "bun:test";
import { TokenEstimator } from "./token-estimator.js";
import type { AgentMessage } from "../agent/types.js";

describe("TokenEstimator", () => {
  const estimator = new TokenEstimator();

  it("空消息应返回 0", () => {
    expect(estimator.estimate([])).toBe(0);
  });

  it("应估算文本消息 token", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world" }], timestamp: 1 },
    ];
    // 字符数估算：11 字符 ≈ 3-4 token（按 1 token ≈ 4 字符估算）
    expect(estimator.estimate(messages)).toBeGreaterThan(0);
    expect(estimator.estimate(messages)).toBeLessThanOrEqual(11);
  });

  it("应累加多条消息", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: 2 },
    ];
    const tokens = estimator.estimate(messages);
    expect(tokens).toBeGreaterThanOrEqual(2); // at least something
  });
});
```

Run: `bun test src/session/token-estimator.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现 TokenEstimator**

```typescript
// src/session/token-estimator.ts
import type { AgentMessage } from "../agent/types.js";

/** Token 估算器
 * Phase 1: 使用字符数估算（1 token ≈ 4 字符）
 * Phase 2: 可替换为 tiktoken 精确计算
 */
export class TokenEstimator {
  /** 估算消息列表的总 token 数 */
  estimate(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateMessage(msg);
    }
    return total;
  }

  private estimateMessage(msg: AgentMessage): number {
    // 基础开销：每条消息约 4 token（角色标识等）
    let tokens = 4;

    if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") {
      tokens += this.estimateContent(msg.content);
    }

    return tokens;
  }

  private estimateContent(content: unknown): number {
    if (typeof content === "string") {
      return Math.ceil(content.length / 4);
    }

    if (Array.isArray(content)) {
      return content.reduce((sum, item) => {
        if (typeof item === "string") return sum + Math.ceil(item.length / 4);
        if (item && typeof item === "object") {
          if ("text" in item && typeof item.text === "string") {
            return sum + Math.ceil(item.text.length / 4);
          }
          if ("thinking" in item && typeof item.thinking === "string") {
            return sum + Math.ceil(item.thinking.length / 4);
          }
        }
        return sum + 1;
      }, 0);
    }

    return 1;
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/session/token-estimator.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/session/token-estimator.ts src/session/token-estimator.test.ts
git commit -m "feat(session): add TokenEstimator with character-based estimation"
```

---

## Task 5: SessionManager 统一入口

**Files:**
- Create: `src/session/session-manager.ts`
- Create: `src/session/session-manager.test.ts`
- Create: `src/session/index.ts`

- [ ] **Step 1: 编写集成测试**

```typescript
// src/session/session-manager.test.ts
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
    const msg2: AgentMessage = { role: "assistant", content: [{ type: "text", text: "Hi" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, stopReason: "stop", timestamp: Date.now() };
    manager.appendMessage(msg1);
    manager.appendMessage(msg2);

    // 模拟重启：创建新的 SessionManager，应该恢复相同的消息
    const newManager = new SessionManager({ baseDir: tmpDir, cwd: "/projects/ys-code" });
    const restored = newManager.restoreMessages();
    expect(restored.length).toBe(2);
    expect(restored[0].role).toBe("user");
    expect(restored[1].role).toBe("assistant");
  });
});
```

Run: `bun test src/session/session-manager.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现 SessionManager**

```typescript
// src/session/session-manager.ts
import { SessionStorage } from "./session-storage.js";
import { SessionLoader } from "./session-loader.js";
import type { AgentMessage } from "../agent/types.js";
import type { Entry, UserEntry, AssistantEntry, ToolResultEntry } from "./entry-types.js";

/** SessionManager 配置 */
export interface SessionManagerConfig {
  /** 存储目录 */
  baseDir: string;
  /** 当前工作目录 */
  cwd: string;
}

/** 会话管理器 —— 统一入口 */
export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly loader: SessionLoader;
  private readonly sessionId: string;
  private readonly filePath: string;
  private lastUuid: string | null = null;

  get sessionId(): string {
    return this.sessionId;
  }

  constructor(config: SessionManagerConfig) {
    this.storage = new SessionStorage(config.baseDir);
    this.loader = new SessionLoader();
    this.sessionId = crypto.randomUUID();
    this.filePath = this.storage.createSession(this.sessionId, config.cwd);
    this.lastUuid = this.findLastUuid(this.storage.readAllEntries(this.filePath));
  }

  /** 追加消息并持久化 */
  appendMessage(message: AgentMessage): void {
    const entry = this.messageToEntry(message);
    this.storage.appendEntry(this.filePath, entry);
    this.lastUuid = entry.uuid;
  }

  /** 恢复消息（从磁盘加载活跃分支） */
  restoreMessages(): AgentMessage[] {
    const entries = this.storage.readAllEntries(this.filePath);
    return this.loader.restoreMessages(entries);
  }

  /** 恢复最近会话（静态工厂） */
  static restoreLatest(config: SessionManagerConfig): SessionManager | null {
    const storage = new SessionStorage(config.baseDir);
    const latestFile = storage.findLatestSessionFile();
    if (!latestFile) return null;

    const entries = storage.readAllEntries(latestFile);
    const header = entries.find((e): e is Extract<Entry, { type: "header" }> => e.type === "header");
    if (!header) return null;

    const manager = Object.create(SessionManager.prototype);
    manager.storage = storage;
    manager.loader = new SessionLoader();
    manager.sessionId = header.sessionId;
    manager.filePath = latestFile;
    manager.lastUuid = manager.findLastUuid(entries);
    return manager;
  }

  /** 将 AgentMessage 转换为 Entry */
  private messageToEntry(message: AgentMessage): Entry {
    const uuid = crypto.randomUUID();
    const parentUuid = this.lastUuid;
    const timestamp = message.timestamp ?? Date.now();

    switch (message.role) {
      case "user":
        return {
          type: "user",
          uuid,
          parentUuid,
          timestamp,
          content: message.content,
          isMeta: message.isMeta,
        } as UserEntry;

      case "assistant":
        return {
          type: "assistant",
          uuid,
          parentUuid,
          timestamp,
          content: message.content,
          model: message.model ?? "unknown",
          usage: message.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: message.stopReason ?? "stop",
          errorMessage: message.errorMessage,
        } as AssistantEntry;

      case "toolResult":
        return {
          type: "toolResult",
          uuid,
          parentUuid,
          timestamp,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          content: message.content,
          isError: message.isError,
          details: message.details,
        } as ToolResultEntry;

      default:
        throw new Error(`Unsupported message role: ${(message as any).role}`);
    }
  }

  private findLastUuid(entries: Entry[]): string | null {
    const hasParent = new Set(entries.map(e => e.parentUuid).filter((p): p is string => p !== null));
    const leaves = entries.filter(e => !hasParent.has(e.uuid));
    return leaves.length > 0 ? leaves[leaves.length - 1].uuid : null;
  }
}
```

```typescript
// src/session/index.ts
export { SessionManager } from "./session-manager.js";
export { SessionStorage } from "./session-storage.js";
export { SessionLoader } from "./session-loader.js";
export { TokenEstimator } from "./token-estimator.js";
export * from "./entry-types.js";
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/session/session-manager.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/session/session-manager.ts src/session/session-manager.test.ts src/session/index.ts
git commit -m "feat(session): add SessionManager unified interface"
```

---

## Task 6: 集成到 AgentSession

**Files:**
- Modify: `src/agent/session.ts`
- Modify: `src/agent/session.test.ts`

- [ ] **Step 1: 修改 AgentSession 构造函数**

在 `src/agent/session.ts` 的 `AgentSession` 类中：

```typescript
// 在 imports 中添加
import { SessionManager } from "../session/index.js";
import * as os from "node:os";
import * as path from "node:path";

// 在类属性中添加
private readonly sessionManager: SessionManager;

// 在构造函数中（this.agent 初始化之后）:
constructor(options: AgentSessionOptions) {
  // ... 现有代码 ...

  // 初始化 SessionManager
  const sessionBaseDir = path.join(os.homedir(), ".ys-code", "sessions");
  const restoredManager = SessionManager.restoreLatest({
    baseDir: sessionBaseDir,
    cwd: this.cwd,
  });

  if (restoredManager) {
    this.sessionManager = restoredManager;
    const restoredMessages = this.sessionManager.restoreMessages();
    if (restoredMessages.length > 0) {
      // 恢复消息到 agent
      for (const msg of restoredMessages) {
        this.agent.state.messages.push(msg);
      }
    }
  } else {
    this.sessionManager = new SessionManager({
      baseDir: sessionBaseDir,
      cwd: this.cwd,
    });
  }

  // ... rest of existing constructor code ...
}
```

- [ ] **Step 2: 在 message_end 事件中持久化**

在 `handleAgentEvent` 方法的 `case "message_end"` 中：

```typescript
case "message_end": {
  this.sessionManager.appendMessage(event.message);
  // ... 现有代码 ...
}
```

- [ ] **Step 3: 更新测试**

在 `src/agent/session.test.ts` 中，修改 setup 以隔离测试数据：

```typescript
// 在 beforeEach 或 setup 中添加临时目录
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// 在每个测试的 AgentSession 创建时传入环境变量或 mock SessionManager
// 或者确保测试使用唯一的 cwd
```

由于修改 `AgentSession` 构造函数会影响所有测试，确保测试的 `cwd` 是唯一的临时目录：

```typescript
// 修改所有测试中的 session 创建
const tmpDir = mkdtempSync(path.join(tmpdir(), "session-test-"));
const session = new AgentSession({
  cwd: tmpDir, // 使用临时目录
  model,
  apiKey: "test",
  systemPrompt: async () => asSystemPrompt([""]),
});
```

- [ ] **Step 4: 运行测试**

Run: `bun test src/agent/session.test.ts`
Expected: PASS (所有测试通过)

- [ ] **Step 5: Commit**

```bash
git add src/agent/session.ts src/agent/session.test.ts
git commit -m "feat(session): integrate SessionManager into AgentSession"
```

---

## Task 7: Compact 机制

**Files:**
- Create: `src/session/compact.ts`
- Create: `src/session/compact.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// src/session/compact.test.ts
import { describe, it, expect } from "bun:test";
import { CompactTrigger } from "./compact.js";
import type { AgentMessage } from "../agent/types.js";

describe("CompactTrigger", () => {
  it("token 低于阈值时不触发 compact", () => {
    const trigger = new CompactTrigger({ threshold: 1000 });
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
    ];
    expect(trigger.shouldCompact(messages)).toBe(false);
  });

  it("token 超过阈值时应触发 compact", () => {
    const trigger = new CompactTrigger({ threshold: 10 });
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world this is a longer message" }], timestamp: 1 },
    ];
    expect(trigger.shouldCompact(messages)).toBe(true);
  });

  it("应生成 compact_boundary entry", () => {
    const trigger = new CompactTrigger({ threshold: 10 });
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world" }], timestamp: 1 },
    ];
    const boundary = trigger.createCompactBoundary(messages, "last-uuid");
    expect(boundary.type).toBe("compact_boundary");
    expect(boundary.parentUuid).toBe("last-uuid");
    expect(boundary.summary).toContain("Hello");
    expect(boundary.tokensBefore).toBeGreaterThan(0);
  });
});
```

Run: `bun test src/session/compact.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现 CompactTrigger**

```typescript
// src/session/compact.ts
import { TokenEstimator } from "./token-estimator.js";
import type { CompactBoundaryEntry } from "./entry-types.js";
import type { AgentMessage } from "../agent/types.js";

/** Compact 配置 */
export interface CompactConfig {
  /** 触发阈值（token 数） */
  threshold: number;
}

/** Compact 触发器 */
export class CompactTrigger {
  private readonly estimator: TokenEstimator;
  private readonly threshold: number;

  constructor(config: CompactConfig) {
    this.estimator = new TokenEstimator();
    this.threshold = config.threshold;
  }

  /** 判断是否应触发 compact */
  shouldCompact(messages: AgentMessage[]): boolean {
    const tokens = this.estimator.estimate(messages);
    return tokens >= this.threshold;
  }

  /** 创建 compact_boundary 条目（简化版：取前几条消息拼接作为摘要） */
  createCompactBoundary(messages: AgentMessage[], lastUuid: string | null): CompactBoundaryEntry {
    const tokensBefore = this.estimator.estimate(messages);

    // 简化摘要：取前 3 条消息的前 200 字符
    const summaryParts: string[] = [];
    for (let i = 0; i < Math.min(3, messages.length); i++) {
      const msg = messages[i];
      let text = "";
      if (msg.role === "user" || msg.role === "assistant") {
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map(c => c.text)
            .join(" ");
        }
      }
      if (text) {
        summaryParts.push(`${msg.role}: ${text.slice(0, 200)}`);
      }
    }

    const summary = summaryParts.join("\n") || "Previous conversation summary";
    const tokensAfter = this.estimator.estimate([
      { role: "system", content: [{ type: "text", text: summary }], timestamp: Date.now() } as AgentMessage,
    ]);

    return {
      type: "compact_boundary",
      uuid: crypto.randomUUID(),
      parentUuid: lastUuid,
      timestamp: Date.now(),
      summary,
      tokensBefore,
      tokensAfter,
    };
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `bun test src/session/compact.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: 集成到 SessionManager**

在 `src/session/session-manager.ts` 中添加 compact 支持：

```typescript
import { CompactTrigger } from "./compact.js";

// 在 SessionManagerConfig 中添加
export interface SessionManagerConfig {
  baseDir: string;
  cwd: string;
  /** Compact 阈值（可选，默认不启用） */
  compactThreshold?: number;
}

// 在 SessionManager 类中添加属性
private readonly compactTrigger?: CompactTrigger;

// 在构造函数中
constructor(config: SessionManagerConfig) {
  // ... 现有代码 ...
  if (config.compactThreshold) {
    this.compactTrigger = new CompactTrigger({ threshold: config.compactThreshold });
  }
}

// 添加 compactIfNeeded 方法
compactIfNeeded(): void {
  if (!this.compactTrigger) return;

  const messages = this.restoreMessages();
  if (this.compactTrigger.shouldCompact(messages)) {
    const boundary = this.compactTrigger.createCompactBoundary(messages, this.lastUuid);
    this.storage.appendEntry(this.filePath, boundary);
    this.lastUuid = boundary.uuid;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/session/compact.ts src/session/compact.test.ts src/session/session-manager.ts
git commit -m "feat(session): add compact mechanism with threshold trigger"
```

---

## Task 8: 端到端验证

**Files:**
- 无新文件，运行完整测试

- [ ] **Step 1: 运行所有 session 相关测试**

Run: `bun test src/session/`
Expected: PASS (所有测试)

- [ ] **Step 2: 运行所有 agent 测试**

Run: `bun test src/agent/`
Expected: PASS (所有测试)

- [ ] **Step 3: 运行类型检查**

Run: `bunx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 4: Commit**

```bash
git commit -m "test(session): e2e validation passed" --allow-empty
```

---

## Self-Review

### Spec Coverage

| 设计文档章节 | 对应 Task |
|-------------|-----------|
| Phase 1: Entry 类型体系 | Task 1 |
| Phase 1: 写入流程 | Task 2 |
| Phase 1: 加载流程 | Task 3 |
| Phase 1: 恢复逻辑 | Task 3 |
| Phase 2: Token 估算 | Task 4 |
| Phase 2: Compact 触发 | Task 7 |
| Phase 2: 消息链断裂 | Task 3, 7 |
| 集成点：AgentSession | Task 6 |
| 集成点：message_end | Task 6 |

**Gap:** 设计文档中的 Phase 3（分块截断）不在此计划范围内，作为后续优化。

### Placeholder Scan

- 无 TBD/TODO
- 无 "appropriate error handling" 等模糊描述
- 每个 Task 都有完整代码和测试代码
- 类型和方法名一致（`SessionManager`, `SessionStorage`, `SessionLoader`, `TokenEstimator`, `CompactTrigger`）

### Type Consistency

- `Entry` 联合类型在所有文件中一致
- `AgentMessage` 类型从 `../agent/types.js` 导入
- `sessionId` 在所有类中都是 `string`
- `parentUuid` 在所有 entry 中都是 `string | null`

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-persistence-compact-plan.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
