import { describe, it, expect } from "bun:test";
import { normalizeMessages, normalizeAttachment } from "./normalize.js";
import type { AttachmentMessage, RelevantMemoriesAttachment, FileAttachment, DirectoryAttachment } from "./types.js";
import type { UserMessage } from "../../core/ai/types.js";
import type { AgentMessage } from "../types.js";
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

describe("normalizeMessages purity", () => {
  it("should not modify input array or its elements", () => {
    const userMsg: AgentMessage = {
      role: "user",
      content: "Hello",
      timestamp: 1000,
    } as AgentMessage;

    const attachmentMsg: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Available skills: read",
        skillNames: ["read"],
        timestamp: 2000,
      },
      timestamp: 2000,
    } as AgentMessage;

    const input = [userMsg, attachmentMsg];
    const originalContent = (userMsg as any).content;

    const result = normalizeMessages(input);

    // 输入数组本身不变
    expect(input).toHaveLength(2);
    expect((input[0] as any).content).toBe(originalContent); // 元素不被修改
    expect(input[1].role).toBe("attachment"); // attachment 元素不变

    // 输出是新数组
    expect(result).not.toBe(input);
    // 输出中 attachment 已展开为 user
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect((result[0] as any).content).toContain("<system-reminder>");
    expect((result[0] as any).content).toContain("Hello");
  });

  it("should merge attachment into previous user message when possible", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "First message", timestamp: 1000 },
      {
        role: "attachment",
        attachment: { type: "relevant_memories", entries: [{ key: "k", value: "v" }], timestamp: 2000 },
        timestamp: 2000,
      },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect((result[0] as any).content).toContain("First message");
    expect((result[0] as any).content).toContain("system-reminder");
  });

  it("should not merge when previous message is not user", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: 1000 },
      {
        role: "attachment",
        attachment: { type: "skill_listing", content: "Skills", skillNames: [], timestamp: 2000 },
        timestamp: 2000,
      },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("assistant");
    expect(result[1].role).toBe("user");
    expect((result[1] as any).content).toContain("system-reminder");
  });

  it("should handle multiple attachments in sequence", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 },
      {
        role: "attachment",
        attachment: { type: "file", filePath: "/a.ts", content: { type: "text", text: "export const a" }, displayPath: "a.ts", timestamp: 2000 },
        timestamp: 2000,
      },
      {
        role: "attachment",
        attachment: { type: "file", filePath: "/b.ts", content: { type: "text", text: "export const b" }, displayPath: "b.ts", timestamp: 3000 },
        timestamp: 3000,
      },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    // 两个 attachment 都应合并到同一个 user message
    expect(result).toHaveLength(1);
    expect((result[0] as any).content).toContain("Hello");
    expect((result[0] as any).content).toContain("/a.ts");
    expect((result[0] as any).content).toContain("/b.ts");
  });

  it("should handle empty messages array", () => {
    const result = normalizeMessages([]);
    expect(result).toHaveLength(0);
  });

  it("should handle messages without attachments", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp: 1000 },
      { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: 2000 },
    ] as AgentMessage[];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });
});

describe("normalizeMessages", () => {
  it("普通 Message 应原样通过", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi", timestamp: 1 },
    ];
    const result = normalizeMessages(messages);
    expect(result).toEqual(messages as any);
  });

  it("独立存在的 attachment 应展开为 UserMessage", () => {
    const messages: AgentMessage[] = [
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
    const messages: AgentMessage[] = [
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
    const messages: AgentMessage[] = [
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
