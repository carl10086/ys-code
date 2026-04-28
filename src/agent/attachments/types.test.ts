import { describe, it, expect } from "bun:test";
import type { AttachmentMessage, Attachment, FileAttachment, DirectoryAttachment, SkillListingAttachment } from "./types.js";
import type { AgentMessage } from "../types.js";

describe("attachment types", () => {
  it("AttachmentMessage 应有 role: attachment", () => {
    const msg: AttachmentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Skills",
        skillNames: [],
        timestamp: 1,
      },
      timestamp: 1,
    };
    expect(msg.role).toBe("attachment");
  });

  it("AgentMessage 应能包含 AttachmentMessage", () => {
    // 这个测试验证 declaration merging 是否生效
    const msg: AgentMessage = {
      role: "attachment",
      attachment: {
        type: "skill_listing",
        content: "Skills",
        skillNames: [],
        timestamp: 1,
      },
      timestamp: 1,
    };
    expect(msg.role).toBe("attachment");
  });

  it("FileAttachment 应有正确的结构", () => {
    const att: FileAttachment = {
      type: "file",
      filePath: "/tmp/test.txt",
      content: { type: "text", file: { filePath: "/tmp/test.txt", content: "hello", numLines: 1, startLine: 1, totalLines: 1 } },
      displayPath: "test.txt",
      truncated: false,
      timestamp: 1,
    };
    expect(att.type).toBe("file");
    expect(att.filePath).toBe("/tmp/test.txt");
    expect(att.content.type).toBe("text");
    expect(att.displayPath).toBe("test.txt");
    expect(att.truncated).toBe(false);
  });

  it("FileAttachment truncated 字段可选", () => {
    const att: FileAttachment = {
      type: "file",
      filePath: "/tmp/test.txt",
      content: { type: "text", file: { filePath: "/tmp/test.txt", content: "hello", numLines: 1, startLine: 1, totalLines: 1 } },
      displayPath: "test.txt",
      timestamp: 1,
    };
    expect(att.truncated).toBeUndefined();
  });

  it("DirectoryAttachment 应有正确的结构", () => {
    const att: DirectoryAttachment = {
      type: "directory",
      path: "/tmp/testdir",
      content: "file1.txt\nfile2.txt",
      displayPath: "testdir",
      timestamp: 1,
    };
    expect(att.type).toBe("directory");
    expect(att.path).toBe("/tmp/testdir");
    expect(att.content).toBe("file1.txt\nfile2.txt");
    expect(att.displayPath).toBe("testdir");
  });

  it("SkillListingAttachment 应有正确的结构", () => {
    const att: SkillListingAttachment = {
      type: "skill_listing",
      content: "Skills",
      skillNames: ["read", "write"],
      timestamp: 1,
    };
    expect(att.type).toBe("skill_listing");
    expect(att.content).toBe("Skills");
    expect(att.skillNames).toEqual(["read", "write"]);
  });

  it("Attachment 联合体应包含所有类型", () => {
    const fileAtt: Attachment = {
      type: "file",
      filePath: "/tmp/test.txt",
      content: { type: "text", file: { filePath: "/tmp/test.txt", content: "hello", numLines: 1, startLine: 1, totalLines: 1 } },
      displayPath: "test.txt",
      timestamp: 1,
    };
    const dirAtt: Attachment = {
      type: "directory",
      path: "/tmp/testdir",
      content: "file1.txt",
      displayPath: "testdir",
      timestamp: 1,
    };
    const skillAtt: Attachment = {
      type: "skill_listing",
      content: "Skills",
      skillNames: ["read"],
      timestamp: 1,
    };
    expect(fileAtt.type).toBe("file");
    expect(dirAtt.type).toBe("directory");
    expect(skillAtt.type).toBe("skill_listing");
  });
});
