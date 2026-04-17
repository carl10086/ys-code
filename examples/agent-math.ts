/**
 * Agent Math Example
 *
 * 演示直接使用 Agent API（自定义 tools、systemPrompt）
 */

import { Type } from "@sinclair/typebox";
import { Agent, type AgentTool } from "../src/agent/index.js";
import { getModel, asSystemPrompt } from "../src/core/ai/index.js";

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

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const agent = new Agent({
  systemPrompt: async () =>
    asSystemPrompt([
      "You are a math assistant. You MUST use the provided tools (add, subtract) for ALL calculations. NEVER compute answers yourself. Always call the appropriate tool.",
    ]),
  initialState: {
    model,
    thinkingLevel: "off",
    tools: [addTool, subtractTool],
  },
  getApiKey: () => process.env.MINIMAX_API_KEY,
});

agent.subscribe((event, signal) => {
  switch (event.type) {
    case "turn_start":
      console.log("[Turn] Started");
      break;
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_delta") {
        process.stdout.write(ae.delta);
      } else if (ae.type === "text_delta") {
        process.stdout.write(ae.delta);
      }
      break;
    }
    case "tool_execution_start":
      console.log(`[Tool] Started: ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case "tool_execution_end":
      console.log(`[Tool] Ended: ${event.toolName}, isError: ${event.isError}`);
      break;
    case "turn_end":
      console.log("\n[Turn] Ended");
      break;
  }
});

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
