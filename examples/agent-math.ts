/**
 * Agent Math Example
 *
 * 演示 Agent 如何使用 tools（加法、减法）
 */

import { Type } from "@sinclair/typebox";
import { Agent, type AgentTool } from "../src/agent/index.js";
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

// 创建 Agent 实例
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
    model,
    tools: [addTool, subtractTool],
    thinkingLevel: "off",
  },
  getApiKey: () => process.env.MINIMAX_API_KEY,
});

// 订阅 agent 事件
agent.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      console.log("[Agent] Started");
      break;
    case "agent_end":
      console.log("[Agent] Ended");
      break;
    case "turn_start":
      console.log("[Turn] Started");
      break;
    case "turn_end":
      console.log(`[Turn] Ended - stopReason: ${event.message.stopReason}`);
      break;
    case "message_start":
      if (event.message.role === "assistant") {
        console.log("[Message] Assistant started");
      }
      break;
    case "message_end":
      if (event.message.role === "assistant") {
        const textContent = event.message.content.find((c) => c.type === "text");
        if (textContent && "text" in textContent) {
          console.log(`[Message] Assistant: ${textContent.text}`);
        }
      }
      break;
    case "tool_execution_start":
      console.log(`[Tool] Started: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case "tool_execution_end":
      console.log(`[Tool] Ended: ${event.toolName}, isError: ${event.isError}`);
      break;
  }
});

// 运行示例
async function main() {
  console.log("=== Agent Math Example ===\n");

  try {
    await agent.prompt("What is 5 + 3? What is 10 - 2?");
    await agent.waitForIdle();

    console.log("\n=== Final State ===");
    console.log(`Messages: ${agent.state.messages.length}`);

    const lastMessage = agent.state.messages[agent.state.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      console.log(`Final response: ${JSON.stringify(lastMessage.content, null, 2)}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
