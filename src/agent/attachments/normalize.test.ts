import { describe, it, expect } from "bun:test";
import { normalizeMessages, normalizeAttachment } from "./normalize.js";
import type { AttachmentMessage, RelevantMemoriesAttachment, FileAttachment, DirectoryAttachment } from "./types.js";
import type { UserMessage, Message } from "../../core/ai/types.js";
import { prependUserContext } from "../context/user-context.js";
import type { UserContext } from "../context/user-context.js";

describe("normalizeAttachment", () => {
  it("relevant_memories 应展开为 system-reminder 包裹的 UserMessage", () => {
    const att: RelevantMemoriesAttachment = {
      type: "relevant_memories",
      entries: [{ key: "CLAUDE.md", value: "# Rule" }],
      timestamp: 1000,
    };
    const result = normalizeAttachment(att);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("CLAUDE.md");
    expect(result[0].content).toContain("# Rule");
    expect(result[0].timestamp).toBe(1000);
  });

  it("空 entries 也应生成完整 wrapper", () => {
    const att: RelevantMemoriesAttachment = {
      type: "relevant_memories",
      entries: [],
      timestamp: 1,
    };
    const result = normalizeAttachment(att);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain("<system-reminder>");
  });
});

describe("normalizeMessages", () => {
  it("普通 Message 应原样通过", () => {
    const messages: Message[] = [
      { role: "user", content: "hi", timestamp: 1 },
    ];
    const result = normalizeMessages(messages);
    expect(result).toEqual(messages);
  });

  it("独立存在的 attachment 应展开为 UserMessage", () => {
    const messages: Message[] = [
      {
        role: "attachment",
        attachment: {
          type: "relevant_memories",
          entries: [{ key: "Test", value: "Value" }],
          timestamp: 1,
        },
        timestamp: 1,
      } as AttachmentMessage,
    ];
    const result = normalizeMessages(messages);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Test");
  });

  it("attachment 前有 UserMessage 时应合并", () => {
    const messages: Message[] = [
      { role: "user", content: "hi", timestamp: 1 },
      {
        role: "attachment",
        attachment: {
          type: "relevant_memories",
          entries: [{ key: "Test", value: "Value" }],
          timestamp: 2,
        },
        timestamp: 2,
      } as AttachmentMessage,
    ];
    const result = normalizeMessages(messages);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("hi");
    expect(result[0].content).toContain("Test");
  });

  it("多个 attachment 连续时应按序处理", () => {
    const messages: Message[] = [
      {
        role: "attachment",
        attachment: {
          type: "relevant_memories",
          entries: [{ key: "A", value: "1" }],
          timestamp: 1,
        },
        timestamp: 1,
      } as AttachmentMessage,
      {
        role: "attachment",
        attachment: {
          type: "relevant_memories",
          entries: [{ key: "B", value: "2" }],
          timestamp: 2,
        },
        timestamp: 2,
      } as AttachmentMessage,
    ];
    const result = normalizeMessages(messages);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain("A");
    expect(result[0].content).toContain("B");
  });

  it("与现有 prependUserContext 输出完全一致", () => {
    // 这是兼容性红线测试
    const context: UserContext = {
      claudeMd: "# Project rules",
      currentDate: "2026/04/19",
    };

    // 旧方式输出
    const oldMessages = prependUserContext([], context);
    const oldContent = (oldMessages[0] as UserMessage).content;

    // 新方式输出
    const att: RelevantMemoriesAttachment = {
      type: "relevant_memories",
      entries: [
        { key: "claudeMd", value: "# Project rules" },
        { key: "currentDate", value: "2026/04/19" },
      ],
      timestamp: Date.now(),
    };
    const newMessages = normalizeAttachment(att);
    const newContent = (newMessages[0] as UserMessage).content;

    expect(newContent).toBe(oldContent);
  });

  it("file 应展开为 FileReadTool tool_use + tool_result 包裹的 system-reminder", () => {
    const att: FileAttachment = {
      type: "file",
      filePath: "/abs/path/to/file.ts",
      content: {
        type: "text",
        file: {
          filePath: "/abs/path/to/file.ts",
          content: "const x = 1;\nconst y = 2;",
          numLines: 2,
          startLine: 1,
          totalLines: 2,
        },
      },
      displayPath: "src/file.ts",
      truncated: false,
      timestamp: 2000,
    };
    const result = normalizeAttachment(att);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("Called the FileReadTool tool");
    expect(result[0].content).toContain('"file_path":"/abs/path/to/file.ts"');
    expect(result[0].content).toContain("Result of calling the FileReadTool tool");
    expect(result[0].content).toContain('"type":"text"');
    expect(result[0].content).toContain('"filePath":"/abs/path/to/file.ts"');
    expect(result[0].content).toContain('"content":"const x = 1;\\nconst y = 2;"');
    expect(result[0].content).toContain('"numLines":2');
    expect(result[0].content).toContain('"startLine":1');
    expect(result[0].content).toContain('"totalLines":2');
    expect(result[0].content).toContain("</system-reminder>");
    expect(result[0].timestamp).toBe(2000);
  });

  it("directory 应展开为 BashTool(ls) tool_use + tool_result 包裹的 system-reminder", () => {
    const att: DirectoryAttachment = {
      type: "directory",
      path: "/abs/path/to/dir",
      content: "file1.ts\nfile2.ts",
      displayPath: "src/dir",
      timestamp: 3000,
    };
    const result = normalizeAttachment(att);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("Called the BashTool tool");
    expect(result[0].content).toContain('"command":"ls /abs/path/to/dir"');
    expect(result[0].content).toContain("Lists files in /abs/path/to/dir");
    expect(result[0].content).toContain("Result of calling the BashTool tool");
    expect(result[0].content).toContain('"stdout":"file1.ts\\nfile2.ts"');
    expect(result[0].content).toContain('"stderr":""');
    expect(result[0].content).toContain('"interrupted":false');
    expect(result[0].content).toContain("</system-reminder>");
    expect(result[0].timestamp).toBe(3000);
  });
});
