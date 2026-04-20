import { AgentSession } from "../src/agent/index.js";
import { getModel, getEnvApiKey } from "../src/core/ai/index.js";
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
} from "../src/cli/format.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
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

async function main() {
  const inputs = [
      "使用 brainstorming skill 分析 agent loop"
    // "写一个 200字的作文， 关于春天",
    // "请告诉我当前目录是什么",
  ];

  for (const text of inputs) {
    process.stdout.write(formatUserMessage(text));
    session.steer(text);
  }

  try {
    await session.prompt("");
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  }

  console.log("\n[DEBUG] session idle, messages count:", session.messages.length);
  process.exit(0);
}

main();
