/**
 * Agent Math Example
 *
 * 演示 AgentSession 如何使用 tools（加法、减法）
 */

import { Type } from "@sinclair/typebox";
import { AgentSession, type AgentTool } from "../src/agent/index.js";
import { getModel } from "../src/core/ai/index.js";

// 定义 math tools
const addTool: AgentTool = {
  name: "add",
  description: "Add two numbers together",
  parameters: Type.Object({
    a: Type.Number({ description: "First number" }),
    b: Type.Number({ description: "Second number" }),
  }),
  label: "Add",
  async execute(toolCallId, params) {
    const result = params.a + params.b;
    return {
      content: [{ type: "text", text: `${params.a} + ${params.b} = ${result}` }],
      details: { result },
    };
  },
};

const subtractTool: AgentTool = {
  name: "subtract",
  description: "Subtract two numbers",
  parameters: Type.Object({
    a: Type.Number({ description: "First number" }),
    b: Type.Number({ description: "Second number" }),
  }),
  label: "Subtract",
  async execute(toolCallId, params) {
    const result = params.a - params.b;
    return {
      content: [{ type: "text", text: `${params.a} - ${params.b} = ${result}` }],
      details: { result },
    };
  },
};

// 创建 AgentSession 实例
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey: process.env.MINIMAX_API_KEY,
  systemPrompt:
    "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
  tools: [addTool, subtractTool],
  thinkingLevel: "off",
});

// 订阅 AgentSession 事件
session.subscribe((event) => {
  switch (event.type) {
    case "turn_start":
      console.log("[Turn] Started");
      break;
    case "thinking_delta":
      if (event.isFirst) console.log("[Thinking]");
      process.stdout.write(event.text);
      break;
    case "answer_delta":
      if (event.isFirst) console.log("\n[Answer]");
      process.stdout.write(event.text);
      break;
    case "tool_start":
      console.log(`[Tool] Started: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case "tool_end":
      console.log(`[Tool] Ended: ${event.toolName}, isError: ${event.isError}`);
      break;
    case "turn_end":
      console.log(`\n[Turn] Ended`);
      break;
  }
});

// 运行示例
async function main() {
  console.log("=== Agent Math Example ===\n");

  try {
    await session.prompt("What is 5 + 3? What is 10 - 2?");
    await session.waitForIdle();

    console.log("\n=== Final State ===");
    console.log(`Messages: ${session.messages.length}`);

    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      console.log(`Final response: ${JSON.stringify(lastMessage.content, null, 2)}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
