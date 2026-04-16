import { describe, it, expect } from "bun:test";
import { defineAgentTool } from "../define-agent-tool.js";
import { Type } from "@sinclair/typebox";

describe("defineAgentTool", () => {
  it("填充安全默认值", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      execute: async () => ({ result: "ok" }),
    });

    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.isDestructive).toBe(false);
  });

  it("允许覆盖默认值", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      isReadOnly: true,
      isConcurrencySafe: true,
      execute: async () => ({ result: "ok" }),
    });

    expect(tool.isReadOnly).toBe(true);
    expect(tool.isConcurrencySafe).toBe(true);
  });

  it("formatResult 默认值将输出转为文本", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      execute: async () => ({ result: "ok" }),
    });

    const result = tool.formatResult?.({ result: "ok" }, "call-1");
    expect(result).toEqual([{ type: "text", text: "[object Object]" }]);
  });

  it("自定义 formatResult 生效", () => {
    const tool = defineAgentTool({
      name: "test",
      description: "test tool",
      parameters: Type.Object({}),
      outputSchema: Type.Object({ result: Type.String() }),
      label: "Test",
      execute: async () => ({ result: "ok" }),
      formatResult: (output) => [{ type: "text", text: output.result }],
    });

    const result = tool.formatResult?.({ result: "ok" }, "call-1");
    expect(result).toEqual([{ type: "text", text: "ok" }]);
  });
});
