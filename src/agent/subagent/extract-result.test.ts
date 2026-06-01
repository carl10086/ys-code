import { describe, it, expect } from "bun:test";
import { extractSubagentResult } from "./extract-result.js";
import type { AgentMessage } from "../types.js";

function createAssistantMessage(text: string, toolCalls?: Array<{ name: string; args: unknown }>): AgentMessage {
  const content: Array<{ type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: unknown }> = [];
  if (text) {
    content.push({ type: "text", text });
  }
  if (toolCalls) {
    for (let i = 0; i < toolCalls.length; i++) {
      content.push({ type: "toolCall", id: `tc-${i}`, name: toolCalls[i].name, arguments: toolCalls[i].args });
    }
  }
  return {
    role: "assistant",
    content,
    stopReason: toolCalls ? "toolUse" : "end_turn",
    api: "anthropic",
    provider: "anthropic",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
  } as AgentMessage;
}

function createToolResultMessage(toolCallId: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "Read",
    content: [{ type: "text", text: "file content" }],
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("extractSubagentResult", () => {
  it("smart 模式取最后一条有实质内容的 assistant", () => {
    const messages: AgentMessage[] = [
      createAssistantMessage("我来帮你查找文件", [{ name: "Grep", args: {} }]),
      createToolResultMessage("tc-0"),
      createAssistantMessage("找到了相关内容，这是总结：\n\n这是一个重要的发现。"),
    ];

    const result = extractSubagentResult(messages, { mode: "smart" });

    expect(result.text).toBe("找到了相关内容，这是总结：\n\n这是一个重要的发现。");
  });

  it("smart 模式最后一条内容过短时回溯到上一条有实质内容的 assistant", () => {
    const messages: AgentMessage[] = [
      createAssistantMessage("我来帮你查找文件", [{ name: "Grep", args: {} }]),
      createToolResultMessage("tc-0"),
      createAssistantMessage("已经找到了目标文件，现在让我读取其中的详细内容进行分析", [{ name: "Read", args: {} }]),
      createToolResultMessage("tc-1"),
      createAssistantMessage("ok"),
    ];

    const result = extractSubagentResult(messages, { mode: "smart" });

    expect(result.text).toBe("已经找到了目标文件，现在让我读取其中的详细内容进行分析");
  });

  it("lastText 模式与现有行为一致", () => {
    const messages: AgentMessage[] = [
      createAssistantMessage("第一条回复"),
      createAssistantMessage("第二条回复"),
    ];

    const result = extractSubagentResult(messages, { mode: "lastText" });

    expect(result.text).toBe("第二条回复");
  });

  it("allAssistantText 模式合并所有 assistant 文本", () => {
    const messages: AgentMessage[] = [
      createAssistantMessage("第一部分分析。"),
      createToolResultMessage("tc-0"),
      createAssistantMessage("第二部分结论。"),
    ];

    const result = extractSubagentResult(messages, { mode: "allAssistantText" });

    expect(result.text).toBe("第一部分分析。\n\n第二部分结论。");
  });

  it("无 assistant 消息时返回空字符串", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() } as AgentMessage,
    ];

    const result = extractSubagentResult(messages, { mode: "smart" });

    expect(result.text).toBe("");
  });

  it("assistant 消息只有 toolCall 无文本时向前回溯", () => {
    const messages: AgentMessage[] = [
      createAssistantMessage("之前的分析", [{ name: "Grep", args: {} }]),
      createToolResultMessage("tc-0"),
      createAssistantMessage("", [{ name: "Write", args: {} }]),
      createToolResultMessage("tc-1"),
    ];

    const result = extractSubagentResult(messages, { mode: "smart" });

    expect(result.text).toBe("之前的分析");
  });
});
