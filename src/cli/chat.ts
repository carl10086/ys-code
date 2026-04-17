import readline from "readline/promises";
import { AgentSession } from "../agent/session.js";
import { getModel, getEnvApiKey, asSystemPrompt } from "../core/ai/index.js";
import {
  formatAICardEnd,
  formatAICardStart,
  formatAnswerPrefix,
  formatTextDelta,
  formatThinkingDelta,
  formatThinkingPrefix,
  formatToolEnd,
  formatToolStart,
  formatToolsPrefix,
  formatUserMessage,
} from "./format.js";

const systemPromptText = process.argv[2] ?? "You are a helpful assistant.";
const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
  systemPrompt: async () => asSystemPrompt([systemPromptText]),
});

session.subscribe((event) => {
  switch (event.type) {
    case "turn_start": {
      process.stdout.write(formatAICardStart(session.model.name));
      break;
    }
    case "thinking_delta": {
      if (event.isFirst) {
        process.stdout.write(formatThinkingPrefix());
      }
      process.stdout.write(formatThinkingDelta(event.text));
      break;
    }
    case "answer_delta": {
      if (event.isFirst) {
        process.stdout.write(formatAnswerPrefix());
      }
      process.stdout.write(formatTextDelta(event.text));
      break;
    }
    case "tool_start": {
      if (event.isFirst) {
        process.stdout.write(formatToolsPrefix());
      }
      process.stdout.write(formatToolStart(event.toolName, event.args));
      break;
    }
    case "tool_end": {
      process.stdout.write(formatToolEnd(event.toolName, event.isError, event.summary, event.timeMs));
      break;
    }
    case "turn_end": {
      process.stdout.write(formatAICardEnd(event.tokens, event.cost, event.timeMs));
      break;
    }
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  if (input === "/exit") { rl.close(); return; }
  if (input === "/new") { session.reset(); console.log("Session reset."); rl.prompt(); return; }
  if (input === "/tools") { console.log(session.tools.map((t) => t.name).join(", ")); rl.prompt(); return; }
  if (input === "/messages") { console.log(JSON.stringify(session.messages, null, 2)); rl.prompt(); return; }
  if (input === "/abort") { session.abort(); rl.prompt(); return; }

  process.stdout.write(formatUserMessage(input));

  try {
    if (session.isStreaming) {
      session.steer(input);
    } else {
      await session.prompt(input);
    }
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  rl.prompt();
});
rl.on("close", async () => {
  await session.waitForIdle();
  process.exit(0);
});
rl.prompt();
