import readline from "readline/promises";
import { Agent } from "../agent/agent.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../tools/index.js";
import {
  formatAICardEnd,
  formatAICardStart,
  formatTextDelta,
  formatThinkingDelta,
  formatToolEnd,
  formatToolStart,
  formatUserMessage,
} from "./format.js";

const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const agent = new Agent({
  initialState: {
    systemPrompt,
    model,
    thinkingLevel: "medium",
    tools: [createReadTool(process.cwd()), createWriteTool(process.cwd()), createEditTool(process.cwd()), createBashTool(process.cwd())],
  },
  getApiKey: () => apiKey,
});

let turnStartTime = 0;
const toolStartTimes = new Map<string, number>();

agent.subscribe((event) => {
  switch (event.type) {
    case "turn_start": {
      turnStartTime = Date.now();
      process.stdout.write(formatAICardStart(agent.state.model.name));
      break;
    }
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_delta") {
        process.stdout.write(formatThinkingDelta(ae.delta));
      } else if (ae.type === "text_delta") {
        process.stdout.write(formatTextDelta(ae.delta));
      }
      break;
    }
    case "tool_execution_start": {
      toolStartTimes.set(event.toolCallId, Date.now());
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_execution_end": {
      const startTime = toolStartTimes.get(event.toolCallId) ?? Date.now();
      toolStartTimes.delete(event.toolCallId);
      const summary = event.isError
        ? String((event.result as any)?.content?.[0]?.text ?? "error")
        : "";
      const elapsed = Date.now() - startTime;
      process.stdout.write(formatToolEnd(event.toolName, event.isError, summary || "done", elapsed));
      break;
    }
    case "turn_end": {
      const elapsed = Date.now() - turnStartTime;
      if (event.message.role === "assistant") {
        const usage = event.message.usage;
        process.stdout.write(formatAICardEnd(usage.totalTokens, usage.cost.total, elapsed));
      } else {
        process.stdout.write(formatAICardEnd(0, 0, elapsed));
      }
      break;
    }
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  if (input === "/exit") { rl.close(); return; }
  if (input === "/new") { agent.reset(); console.log("Session reset."); rl.prompt(); return; }
  if (input === "/system") { console.log(agent.state.systemPrompt); rl.prompt(); return; }
  if (input === "/tools") { console.log(agent.state.tools.map((t) => t.name).join(", ")); rl.prompt(); return; }
  if (input === "/messages") { console.log(JSON.stringify(agent.state.messages, null, 2)); rl.prompt(); return; }
  if (input === "/abort") { agent.abort(); rl.prompt(); return; }

  process.stdout.write(formatUserMessage(input));

  try {
    if (agent.state.isStreaming) {
      agent.steer({ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() });
    } else {
      await agent.prompt(input);
    }
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  rl.prompt();
});
rl.on("close", async () => {
  await agent.waitForIdle();
  process.exit(0);
});
rl.prompt();
