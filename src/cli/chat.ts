// src/cli/chat.ts
import readline from "readline/promises";
import chalk from "chalk";
import { Agent } from "../agent/agent.js";
import type { AgentEvent, AgentMessage } from "../agent/types.js";
import { getModel, getEnvApiKey } from "../core/ai/index.js";
import { createReadTool, createWriteTool, createEditTool, createBashTool } from "../tools/index.js";

const systemPrompt = process.argv[2] ?? "You are a helpful assistant.";

const model = getModel("minimax", "MiniMax-M2.7");
if (!model) {
  console.error(chalk.red("Error: model not found"));
  process.exit(1);
}

const apiKey = getEnvApiKey(model.provider);
if (!apiKey) {
  console.error(chalk.red(`Error: API key not found for provider "${model.provider}"`));
  process.exit(1);
}

const agent = new Agent({
  initialState: {
    systemPrompt,
    model,
    thinkingLevel: "medium",
    tools: [createReadTool(process.cwd()), createWriteTool(process.cwd()), createEditTool(process.cwd()), createBashTool(process.cwd())],
  },
});

let isStreaming = false;

agent.subscribe((event) => {
  handleEvent(event);
});

function handleEvent(event: AgentEvent): void {
  switch (event.type) {
    case "agent_start": {
      isStreaming = true;
      process.stdout.write("▶ ");
      break;
    }
    case "agent_end": {
      isStreaming = false;
      process.stdout.write("\n");
      break;
    }
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "text_delta") {
        process.stdout.write(ae.delta);
      } else if (ae.type === "thinking_delta") {
        process.stdout.write(chalk.gray(ae.delta));
      }
      break;
    }
    case "tool_execution_start": {
      process.stdout.write(`\n🔧 ${event.toolName}\n`);
      break;
    }
    case "tool_execution_end": {
      const result = event.result as { content?: Array<{ type: string; text?: string }> } | undefined;
      const isError = event.isError;
      const prefix = isError ? "✗" : "✓";
      const summary = result?.content?.map((c) => (c.type === "text" ? c.text : "")).join("").slice(0, 80) ?? "";
      process.stdout.write(`${prefix} ${summary}${summary.length >= 80 ? "..." : ""}\n`);
      break;
    }
    case "turn_end": {
      if (event.message.role === "assistant") {
        const usage = (event.message as Extract<AgentMessage, { role: "assistant" }>).usage;
        if (usage) {
          process.stdout.write(
            chalk.dim(
              `\nTokens: ${usage.totalTokens} | Cost: $${usage.cost.total.toFixed(6)}\n`,
            ),
          );
        }
      }
      break;
    }
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "/exit") {
      rl.close();
      return;
    }

    if (input === "/new") {
      agent.reset();
      console.log(chalk.dim("Session reset."));
      rl.prompt();
      return;
    }

    if (input === "/system") {
      console.log(agent.state.systemPrompt);
      rl.prompt();
      return;
    }

    if (input === "/tools") {
      console.log(agent.state.tools.map((t) => t.name).join(", "));
      rl.prompt();
      return;
    }

    if (input === "/messages") {
      console.log(JSON.stringify(agent.state.messages, null, 2));
      rl.prompt();
      return;
    }

    if (input === "/abort") {
      agent.abort();
      rl.prompt();
      return;
    }

    try {
      if (isStreaming) {
        agent.steer({
          role: "user",
          content: [{ type: "text", text: input }],
          timestamp: Date.now(),
        });
      } else {
        await agent.prompt(input);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main();
