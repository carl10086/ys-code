import { AgentSession } from "../src/agent/index.js";
import { getModel, getEnvApiKey } from "../src/core/ai/index.js";
import { getCommands } from "../src/commands/index.js";
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
import { join } from "node:path";
import * as readline from "node:readline";

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

/**
 * 列出所有可用的 skills（type === "prompt"）
 */
async function listAvailableSkills(): Promise<void> {
  const skillsBasePath = join(process.cwd(), ".claude/skills");
  const commands = await getCommands(skillsBasePath);
  const promptCommands = commands.filter((cmd) => cmd.type === "prompt");

  console.log("\n[DEBUG] Available skills:");
  for (const cmd of promptCommands) {
    console.log(`  - ${cmd.name}`);
  }
  console.log();
}

/**
 * 从用户输入中解析 skill 名称
 * 格式: "执行 <skill-name> skill" 或 "执行 <skill-name>skill"
 */
function parseSkillInvocation(input: string): string | null {
  const match = input.match(/^执行\s+(\S+?)\s*skill$/);
  return match ? match[1] : null;
}

async function main() {
  // 列出可用 skills
  await listAvailableSkills();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  // 跟踪是否正在处理输入
  let isProcessing = false;
  // 跟踪是否应该退出（当 stdin 关闭且没有待处理的 prompt）
  let shouldExit = false;

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // 如果正在处理中，使用 followUp 排队，否则用 steer
    if (isProcessing) {
      console.log(`\n[DEBUG] Queueing followUp: ${input}\n`);
      session.followUp(input);
      rl.prompt();
      return;
    }

    isProcessing = true;

    // 解析 skill 调用指令
    const skillName = parseSkillInvocation(input);

    if (skillName) {
      // 使用 SkillTool 调用 skill
      console.log(`\n[DEBUG] Invoking skill: ${skillName}\n`);
      process.stdout.write(formatUserMessage(input));

      // 调用 skill：使用 steer 触发 SkillTool
      session.steer(`执行 ${skillName} skill`);
    } else {
      // 普通对话
      process.stdout.write(formatUserMessage(input));
      session.steer(input);
    }

    try {
      await session.prompt("");
    } catch (err) {
      console.error(`\n[ERROR] ${err}`);
    } finally {
      isProcessing = false;
    }

    console.log("\n[DEBUG] session messages count:", session.messages.length);

    // 如果 stdin 已关闭且应该退出，则退出
    if (shouldExit) {
      rl.close();
      return;
    }

    rl.prompt();
  });

  rl.on("close", () => {
    // 如果正在处理中，标记应该退出而不是立即退出
    if (isProcessing) {
      shouldExit = true;
      return;
    }
    console.log("\n[DEBUG] Goodbye!");
    process.exit(0);
  });
}

main();
