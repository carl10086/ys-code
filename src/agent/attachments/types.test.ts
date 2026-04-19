import { describe, it, expect } from "bun:test";
import type { AttachmentMessage, RelevantMemoriesAttachment, Attachment } from "./types.js";
import type { AgentMessage } from "../types.js";

describe("attachment types", () => {
  it("RelevantMemoriesAttachment 应有正确的结构", () => {
    const att: RelevantMemoriesAttachment = {
      type: "relevant_memories",
      entries: [{ key: "CLAUDE.md", value: "# Rule" }],
      timestamp: 1,
    };
    expect(att.type).toBe("relevant_memories");
    expect(att.entries.length).toBe(1);
  });

  it("AttachmentMessage 应有 role: attachment", () => {
    const msg: AttachmentMessage = {
      role: "attachment",
      attachment: {
        type: "relevant_memories",
        entries: [],
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
        type: "relevant_memories",
        entries: [],
        timestamp: 1,
      },
      timestamp: 1,
    };
    expect(msg.role).toBe("attachment");
  });
});
