import { getModel, streamSimple } from "../src/core/ai/index.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");

const stream = streamSimple(
	model,
	{
		messages: [
			{
				role: "user",
				content: "Hello, who are you?",
				timestamp: Date.now(),
			},
		],
	},
	{
		apiKey: process.env.MINIMAX_API_KEY,
	},
);

for await (const event of stream) {
	if (event.type === "text_delta") {
		process.stdout.write(event.delta);
	} else if (event.type === "thinking_delta") {
		// Skip thinking output for cleaner display
	} else if (event.type === "done") {
		console.log("\n");
		console.log("---");
		console.log(`Model: ${event.message.model}`);
		console.log(`Provider: ${event.message.provider}`);
		console.log(`Usage: input=${event.message.usage.input}, output=${event.message.usage.output}`);
		console.log(`Cost: $${event.message.usage.cost.total.toFixed(6)}`);
	} else if (event.type === "error") {
		console.error("Error:", event.error.errorMessage);
	}
}
