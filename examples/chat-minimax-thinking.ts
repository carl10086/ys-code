import { getModel, streamSimple } from "../src/core/ai/index.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const stream = streamSimple(
  model,
  {
    messages: [
      {
        role: "user",
        content: "Calculate 15 * 23 + 47",
        timestamp: Date.now(),
      },
    ],
  },
  {
    apiKey: process.env.MINIMAX_API_KEY,
    reasoning: "medium",
  },
);

for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(` [text: ${event.delta}`);
  } else if (event.type === "thinking_delta") {
    // thinking 事件流
    process.stdout.write(`[thinking: ${event.delta}]`);
  } else if (event.type === "done") {
    console.log("\n---");
    console.log(`Model: ${event.message.model}`);
    console.log(`Stop reason: ${event.message.stopReason}`);
    console.log(`Usage: input=${event.message.usage.input}, output=${event.message.usage.output}`);
  } else if (event.type === "error") {
    console.error("Error:", event.error.errorMessage);
  }
}
