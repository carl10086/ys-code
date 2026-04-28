import { describe, it, expect } from "bun:test";
import { normalizeMessages, normalizeAttachment } from "./normalize.js";
import type { FileAttachment, DirectoryAttachment } from "./types.js";
import type { AgentMessage } from "../types.js";

describe("normalizeAttachment", () => {
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

  it("skill_listing 应展开为 system-reminder 包裹的 UserMessage", () => {
    const result = normalizeAttachment({
      type: "skill_listing",
      content: "Available skills: read\nwrite",
      skillNames: ["read", "write"],
      timestamp: 4000,
    });
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<system-reminder>");
    expect(result[0].content).toContain("You can use the following skills:");
    expect(result[0].content).toContain("Available skills: read\nwrite");
    expect(result[0].content).toContain("To use a skill, call the SkillTool with the skill name.");
    expect(result[0].content).toContain("</system-reminder>");
    expect(result[0].timestamp).toBe(4000);
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
        attachment: { type: "skill_listing", content: "Skills", skillNames: [], timestamp: 2000 },
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

  it("独立存在的 skill_listing attachment 应展开为 UserMessage", () => {
    const messages: AgentMessage[] = [
      {
        role: "attachment",
        attachment: {
          type: "skill_listing",
          content: "Skills",
          skillNames: ["read"],
          timestamp: 1,
        },
        timestamp: 1,
      },
    ];
    const result = normalizeMessages(messages);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Skills");
  });

  it("attachment 前有 UserMessage 时应合并", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi", timestamp: 1 },
      {
        role: "attachment",
        attachment: {
          type: "skill_listing",
          content: "Skills",
          skillNames: ["read"],
          timestamp: 2,
        },
        timestamp: 2,
      },
    ];
    const result = normalizeMessages(messages);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("hi");
    expect(result[0].content).toContain("Skills");
  });

  it("多个 attachment 连续时应按序处理", () => {
    const messages: AgentMessage[] = [
      {
        role: "attachment",
        attachment: {
          type: "skill_listing",
          content: "Skill A",
          skillNames: ["a"],
          timestamp: 1,
        },
        timestamp: 1,
      },
      {
        role: "attachment",
        attachment: {
          type: "skill_listing",
          content: "Skill B",
          skillNames: ["b"],
          timestamp: 2,
        },
        timestamp: 2,
      },
    ];
    const result = normalizeMessages(messages);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain("Skill A");
    expect(result[0].content).toContain("Skill B");
  });
});
