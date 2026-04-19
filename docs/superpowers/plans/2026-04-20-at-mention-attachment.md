# @file Attachment 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ys-code 中实现最小可行的 `@file` attachment 系统，支持用户输入中 `@/path/to/file` 引用文件，自动读取并作为 `type: "file"` 的 attachment 注入消息流，对齐 cc 行为。

**Architecture:** 扩展现有 attachment 类型系统（新增 `file`/`directory`），在 `normalizeAttachment` 中生成模拟 tool_use + tool_result 的文本（包装在 `system-reminder` 中）。`streamAssistantResponse` 在每轮请求前扫描 user message 中的 `@...`，异步读取文件并在对应 user message 后插入 AttachmentMessage。

**Tech Stack:** TypeScript, Bun, bun:test

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/agent/attachments/types.ts` | 修改 | 扩展 Attachment 联合类型，新增 FileAttachment、DirectoryAttachment |
| `src/agent/attachments/types.test.ts` | 修改 | 新增 FileAttachment、DirectoryAttachment 类型测试 |
| `src/agent/attachments/normalize.ts` | 修改 | 新增 `file`、`directory` normalize case |
| `src/agent/attachments/normalize.test.ts` | 修改 | 新增 file/directory normalize 测试 |
| `src/agent/attachments/at-mention.ts` | 新增 | `@...` 路径解析、文件读取、Attachment 生成 |
| `src/agent/attachments/at-mention.test.ts` | 新增 | at-mention 解析、读取、normalize 测试 |
| `src/agent/stream-assistant.ts` | 修改 | 增加 `injectAtMentionAttachments` 调用 |
| `src/agent/stream-assistant.test.ts` | 新增 | 端到端集成测试 |

---

### Task 1: 扩展 Attachment 类型定义

**Files:**
- Modify: `src/agent/attachments/types.ts`
- Test: `src/agent/attachments/types.test.ts`

- [ ] **Step 1: 写失败测试（FileAttachment 结构）**

```typescript
import { describe, it, expect } from "bun:test";
import type { FileAttachment, DirectoryAttachment } from "./types.js";

describe("file attachment types", () => {
  it("FileAttachment 应有正确的结构", () => {
    const att: FileAttachment = {
      type: "file",
      filePath: "/test/file.ts",
      content: "const x = 1;",
      displayPath: "file.ts",
      timestamp: 1,
    };
    expect(att.type).toBe("file");
    expect(att.filePath).toBe("/test/file.ts");
    expect(att.content).toBe("const x = 1;");
    expect(att.displayPath).toBe("file.ts");
  });

  it("DirectoryAttachment 应有正确的结构", () => {
    const att: DirectoryAttachment = {
      type: "directory",
      path: "/test/dir",
      content: "file1.ts\nfile2.ts",
      displayPath: "dir",
      timestamp: 1,
    };
    expect(att.type).toBe("directory");
    expect(att.path).toBe("/test/dir");
    expect(att.content).toBe("file1.ts\nfile2.ts");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/attachments/types.test.ts`
Expected: FAIL with "Cannot find name 'FileAttachment'"

- [ ] **Step 3: 实现类型定义**

```typescript
// src/agent/attachments/types.ts

/** 文件附件（@... 引用） */
export interface FileAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "file";
  /** 文件绝对路径 */
  filePath: string;
  /** 文件内容 */
  content: string;
  /** 相对路径（用于显示） */
  displayPath: string;
  /** 是否因大小限制被截断 */
  truncated?: boolean;
}

/** 目录附件（@... 引用目录） */
export interface DirectoryAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "directory";
  /** 目录绝对路径 */
  path: string;
  /** 目录内容（ls 结果） */
  content: string;
  /** 相对路径（用于显示） */
  displayPath: string;
}

/** 附件联合体 */
export type Attachment = RelevantMemoriesAttachment | FileAttachment | DirectoryAttachment;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/attachments/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/attachments/types.ts src/agent/attachments/types.test.ts
git commit -m "feat(attachment): add FileAttachment and DirectoryAttachment types"
```

---

### Task 2: 扩展 normalizeAttachment

**Files:**
- Modify: `src/agent/attachments/normalize.ts`
- Test: `src/agent/attachments/normalize.test.ts`

- [ ] **Step 1: 写失败测试（file normalize）**

```typescript
// 在 src/agent/attachments/normalize.test.ts 中追加

import type { FileAttachment, DirectoryAttachment } from "./types.js";

describe("normalizeAttachment file/directory", () => {
  it("file attachment 应展开为模拟 FileReadTool 的 system-reminder", () => {
    const att: FileAttachment = {
      type: "file",
      filePath: "/test/logger.ts",
      content: "export const logger = {}",
      displayPath: "logger.ts",
      timestamp: 1000,
    };
    const result = normalizeAttachment(att);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("FileReadTool");
    expect(result[0].content).toContain("/test/logger.ts");
    expect(result[0].content).toContain("export const logger = {}");
  });

  it("directory attachment 应展开为模拟 BashTool(ls) 的 system-reminder", () => {
    const att: DirectoryAttachment = {
      type: "directory",
      path: "/test/src",
      content: "file1.ts\nfile2.ts",
      displayPath: "src",
      timestamp: 1000,
    };
    const result = normalizeAttachment(att);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("BashTool");
    expect(result[0].content).toContain("ls /test/src");
    expect(result[0].content).toContain("file1.ts");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/attachments/normalize.test.ts`
Expected: FAIL with "Invalid attachment type: file"（或类似 exhaustiveness check 错误）

- [ ] **Step 3: 实现 normalizeAttachment 扩展**

```typescript
// src/agent/attachments/normalize.ts

// 新增辅助函数
function wrapInSystemReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`;
}

function createToolUseMessage(toolName: string, input: Record<string, unknown>): string {
  return `Called the ${toolName} tool with the following input: ${JSON.stringify(input)}`;
}

function createToolResultMessage(toolName: string, result: Record<string, unknown>): string {
  return `Result of calling the ${toolName} tool:\n${JSON.stringify(result)}`;
}

// 修改 normalizeAttachment 函数
export function normalizeAttachment(attachment: Attachment): UserMessage[] {
  switch (attachment.type) {
    case "relevant_memories": {
      // ... 现有代码不变 ...
    }
    case "file": {
      const toolUse = createToolUseMessage("FileReadTool", {
        file_path: attachment.filePath,
      });
      const toolResult = createToolResultMessage("FileReadTool", {
        filePath: attachment.filePath,
        content: attachment.content,
        numLines: attachment.content.split("\n").length,
        startLine: 1,
        totalLines: attachment.content.split("\n").length,
      });
      const content = wrapInSystemReminder(`${toolUse}\n\n${toolResult}`);
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    case "directory": {
      const toolUse = createToolUseMessage("BashTool", {
        command: `ls ${attachment.path}`,
        description: `Lists files in ${attachment.path}`,
      });
      const toolResult = createToolResultMessage("BashTool", {
        stdout: attachment.content,
        stderr: "",
        interrupted: false,
      });
      const content = wrapInSystemReminder(`${toolUse}\n\n${toolResult}`);
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
    default: {
      const _exhaustive: never = attachment;
      return [];
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/attachments/normalize.test.ts`
Expected: PASS（包括现有 relevant_memories 测试也继续通过）

- [ ] **Step 5: Commit**

```bash
git add src/agent/attachments/normalize.ts src/agent/attachments/normalize.test.ts
git commit -m "feat(attachment): add file and directory normalize cases"
```

---

### Task 3: @... 路径解析

**Files:**
- Create: `src/agent/attachments/at-mention.ts`
- Test: `src/agent/attachments/at-mention.test.ts`

- [ ] **Step 1: 写失败测试（extractAtMentionedFiles）**

```typescript
// src/agent/attachments/at-mention.test.ts

import { describe, it, expect } from "bun:test";
import { extractAtMentionedFiles } from "./at-mention.js";

describe("extractAtMentionedFiles", () => {
  it("应提取普通 @file 路径", () => {
    const result = extractAtMentionedFiles("查看 @src/utils/logger.ts 的代码");
    expect(result).toEqual(["src/utils/logger.ts"]);
  });

  it("应提取多个 @file 路径", () => {
    const result = extractAtMentionedFiles("对比 @a.ts 和 @b.ts 的区别");
    expect(result).toEqual(["a.ts", "b.ts"]);
  });

  it("应提取带引号的 @\"...\" 路径", () => {
    const result = extractAtMentionedFiles('查看 @"my file.ts" 的代码');
    expect(result).toEqual(["my file.ts"]);
  });

  it("无 @ 时应返回空数组", () => {
    const result = extractAtMentionedFiles("普通消息");
    expect(result).toEqual([]);
  });

  it("不应提取 email", () => {
    const result = extractAtMentionedFiles("联系 user@example.com");
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/attachments/at-mention.test.ts`
Expected: FAIL with "Cannot find module './at-mention.js'"

- [ ] **Step 3: 实现 extractAtMentionedFiles**

```typescript
// src/agent/attachments/at-mention.ts

/**
 * 从文本中提取 @... 提到的文件路径
 * 支持普通路径：@file.ts、@src/utils/logger.ts
 * 支持带引号路径（空格）：@"my file.ts"
 * 不支持行号范围（第一阶段简化）
 */
export function extractAtMentionedFiles(content: string): string[] {
  const results: string[] = [];

  // 带引号的路径：@"path with spaces"
  const quotedRegex = /(^|\s)@"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRegex.exec(content)) !== null) {
    if (match[2]) {
      results.push(match[2]);
    }
  }

  // 普通路径：@path（以空格或行首开头）
  const regularRegex = /(^|\s)@([^\s]+)\b/g;
  while ((match = regularRegex.exec(content)) !== null) {
    const path = match[2];
    // 跳过已处理的带引号路径（以 " 开头）
    if (path && !path.startsWith('"')) {
      // 排除 email 格式（包含 @ 的完整 email）
      if (!path.includes("@")) {
        results.push(path);
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/attachments/at-mention.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/attachments/at-mention.ts src/agent/attachments/at-mention.test.ts
git commit -m "feat(attachment): add @... mention file extraction"
```

---

### Task 4: 文件读取与 Attachment 生成

**Files:**
- Modify: `src/agent/attachments/at-mention.ts`
- Test: `src/agent/attachments/at-mention.test.ts`

- [ ] **Step 1: 写失败测试（readAtMentionedFile）**

```typescript
// 在 src/agent/attachments/at-mention.test.ts 中追加

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readAtMentionedFile } from "./at-mention.js";
import type { FileAttachment, DirectoryAttachment } from "./types.js";

describe("readAtMentionedFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "at-mention-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应读取文本文件生成 FileAttachment", async () => {
    writeFileSync(join(tempDir, "test.ts"), "const x = 1;\n");
    const result = await readAtMentionedFile(join(tempDir, "test.ts"), tempDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("file");
    expect((result as FileAttachment).content).toBe("const x = 1;\n");
    expect((result as FileAttachment).displayPath).toBe("test.ts");
  });

  it("应读取目录生成 DirectoryAttachment", async () => {
    mkdirSync(join(tempDir, "subdir"));
    writeFileSync(join(tempDir, "subdir", "a.ts"), "");
    writeFileSync(join(tempDir, "subdir", "b.ts"), "");
    const result = await readAtMentionedFile(join(tempDir, "subdir"), tempDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("directory");
    expect((result as DirectoryAttachment).content).toContain("a.ts");
    expect((result as DirectoryAttachment).content).toContain("b.ts");
  });

  it("文件不存在时应返回 null", async () => {
    const result = await readAtMentionedFile(join(tempDir, "noexist.ts"), tempDir);
    expect(result).toBeNull();
  });

  it("应支持相对路径（基于 cwd）", async () => {
    writeFileSync(join(tempDir, "relative.ts"), "hello");
    const result = await readAtMentionedFile("relative.ts", tempDir);
    expect(result).not.toBeNull();
    expect((result as FileAttachment).filePath).toBe(join(tempDir, "relative.ts"));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/attachments/at-mention.test.ts`
Expected: FAIL with "Cannot find name 'readAtMentionedFile'"

- [ ] **Step 3: 实现 readAtMentionedFile**

```typescript
// src/agent/attachments/at-mention.ts

import { readFileSync, statSync, readdirSync } from "fs";
import { resolve, relative } from "path";
import type { FileAttachment, DirectoryAttachment } from "./types.js";

/** 单个文件最大读取大小（字节） */
const MAX_FILE_SIZE = 200 * 1024;

/**
 * 读取 @... 提到的文件或目录，生成对应的 Attachment
 * @param filePath 文件路径（支持绝对路径和相对路径）
 * @param cwd 当前工作目录（用于解析相对路径）
 * @returns FileAttachment、DirectoryAttachment 或 null（文件不存在/不可读）
 */
export async function readAtMentionedFile(
  filePath: string,
  cwd: string,
): Promise<FileAttachment | DirectoryAttachment | null> {
  const absolutePath = resolve(cwd, filePath);

  try {
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      const entries = readdirSync(absolutePath, { withFileTypes: true });
      const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      const content = names.join("\n");

      return {
        type: "directory",
        path: absolutePath,
        content,
        displayPath: relative(cwd, absolutePath),
        timestamp: Date.now(),
      };
    }

    if (stats.size > MAX_FILE_SIZE) {
      // 大文件：读取前 N 行并标记 truncated
      const fd = readFileSync(absolutePath, "utf-8");
      const lines = fd.split("\n");
      const maxLines = 1000;
      const truncated = lines.length > maxLines;
      const content = truncated ? lines.slice(0, maxLines).join("\n") : fd;

      return {
        type: "file",
        filePath: absolutePath,
        content,
        displayPath: relative(cwd, absolutePath),
        truncated,
        timestamp: Date.now(),
      };
    }

    const content = readFileSync(absolutePath, "utf-8");

    return {
      type: "file",
      filePath: absolutePath,
      content,
      displayPath: relative(cwd, absolutePath),
      timestamp: Date.now(),
    };
  } catch {
    // 文件不存在或不可读：静默失败
    return null;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/attachments/at-mention.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/attachments/at-mention.ts src/agent/attachments/at-mention.test.ts
git commit -m "feat(attachment): add readAtMentionedFile for file/directory reading"
```

---

### Task 5: stream-assistant 集成

**Files:**
- Modify: `src/agent/stream-assistant.ts`
- Create: `src/agent/stream-assistant.test.ts`

- [ ] **Step 1: 写失败测试（injectAtMentionAttachments）**

```typescript
// src/agent/stream-assistant.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { injectAtMentionAttachments } from "./stream-assistant.js";
import type { AgentMessage } from "./types.js";

describe("injectAtMentionAttachments", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stream-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应扫描 user message 中的 @... 并注入 attachment", async () => {
    writeFileSync(join(tempDir, "test.ts"), "const x = 1;");
    const messages: AgentMessage[] = [
      { role: "user", content: "查看 @test.ts", timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("attachment");
    expect((result[1] as any).attachment.type).toBe("file");
  });

  it("无 @... 时应原样返回", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "普通消息", timestamp: 1 },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
  });

  it("非 user message 应跳过", async () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 1, stopReason: "end" },
    ];
    const result = await injectAtMentionAttachments(messages, tempDir);
    expect(result.length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/agent/stream-assistant.test.ts`
Expected: FAIL with "Cannot find name 'injectAtMentionAttachments'"

- [ ] **Step 3: 实现 injectAtMentionAttachments**

```typescript
// src/agent/stream-assistant.ts

import { extractAtMentionedFiles, readAtMentionedFile } from "./attachments/at-mention.js";

/**
 * 扫描消息流中 user message 的 @... 引用，异步读取文件并在对应 user message 后插入 AttachmentMessage
 * @param messages 当前消息流
 * @param cwd 当前工作目录（用于解析相对路径）
 * @returns 注入 attachment 后的新消息流
 */
export async function injectAtMentionAttachments(
  messages: AgentMessage[],
  cwd: string,
): Promise<AgentMessage[]> {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    result.push(msg);

    if (msg.role !== "user" || typeof msg.content !== "string") {
      continue;
    }

    const mentionedFiles = extractAtMentionedFiles(msg.content);
    if (mentionedFiles.length === 0) {
      continue;
    }

    const attachments = await Promise.all(
      mentionedFiles.map((fp) => readAtMentionedFile(fp, cwd)),
    );

    for (const attachment of attachments) {
      if (attachment) {
        result.push({
          role: "attachment",
          attachment,
          timestamp: Date.now(),
        } as AgentMessage);
      }
    }
  }

  return result;
}
```

然后在 `streamAssistantResponse` 中增加调用（在 userContext 注入之后、normalizeMessages 之前）：

```typescript
// streamAssistantResponse 函数内

let messages = context.messages;

// 1. 注入 userContext（relevant_memories）
if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  const attachments = getUserContextAttachments(userContext);
  messages = [...attachments, ...messages];
}

// 2. 注入 @file attachment（新增）
messages = await injectAtMentionAttachments(messages, process.cwd());

// 3. normalize（attachment → UserMessage）
const normalizedMessages = normalizeMessages(messages);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/agent/stream-assistant.test.ts`
Expected: PASS

- [ ] **Step 5: 运行全部测试确认无回归**

Run: `bun test src/agent/attachments/ src/agent/stream-assistant.test.ts`
Expected: ALL PASS（包括现有 relevant_memories 测试）

- [ ] **Step 6: Commit**

```bash
git add src/agent/stream-assistant.ts src/agent/stream-assistant.test.ts
git commit -m "feat(stream-assistant): integrate @file attachment injection"
```

---

## Self-Review

**1. Spec coverage：**
- ✅ Attachment 类型扩展（Task 1）
- ✅ normalizeAttachment file/directory case（Task 2）
- ✅ @... 路径解析（Task 3）
- ✅ 文件读取与 Attachment 生成（Task 4）
- ✅ stream-assistant 集成注入（Task 5）

**2. Placeholder scan：**
- ✅ 无 TBD/TODO/implement later
- ✅ 每个步骤都有完整代码
- ✅ 每个步骤都有具体命令和预期输出

**3. Type consistency：**
- ✅ `FileAttachment` / `DirectoryAttachment` 类型定义在 Task 1，在 Task 2、4、5 中使用一致
- ✅ `extractAtMentionedFiles` / `readAtMentionedFile` / `injectAtMentionAttachments` 签名一致
- ✅ `normalizeAttachment` 新增的 case 与类型定义完全对应

---

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2026-04-20-at-mention-attachment.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?