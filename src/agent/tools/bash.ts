// src/agent/tools/bash.ts
import { Type, type Static } from "@sinclair/typebox";
import { spawn } from "child_process";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const bashSchema = Type.Object({
  command: Type.String({ description: "The command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds" })),
  description: Type.Optional(Type.String({ description: "Clear, concise description of what the command does" })),
  run_in_background: Type.Optional(Type.Boolean({ description: "Set to true to run this command in the background" })),
  dangerouslyDisableSandbox: Type.Optional(Type.Boolean({ description: "Set this to true to dangerously override sandbox mode" })),
});

const bashOutputSchema = Type.Object({
  stdout: Type.String(),
  stderr: Type.String(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  interrupted: Type.Boolean(),
  backgroundTaskId: Type.Optional(Type.String()),
  assistantAutoBackgrounded: Type.Optional(Type.Boolean()),
  dangerouslyDisableSandbox: Type.Optional(Type.Boolean()),
});

type BashInput = Static<typeof bashSchema>;
type BashOutput = Static<typeof bashOutputSchema>;

/** 检测被阻止的 sleep 命令模式 */
function detectBlockedSleepPattern(command: string): string | null {
  const patterns = [
    /^sleep\s+(\d+(?:\.\d+)?)$/,
    /;\s*sleep\s+(\d+(?:\.\d+)?)$/,
    /&&\s*sleep\s+(\d+(?:\.\d+)?)$/,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      const seconds = parseFloat(match[1]);
      if (seconds >= 2) {
        return `sleep ${seconds}`;
      }
    }
  }
  return null;
}

export function createBashTool(cwd: string): AgentTool<typeof bashSchema, BashOutput> {
  return defineAgentTool({
    name: "Bash",
    label: "Bash",
    description: `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
- Communication: Output text directly (NOT echo/printf)

While the Bash tool can do similar things, it's better to use the built-in tools as they provide a much better experience for the user and make it easier to review tool calls and give permission.

# Instructions
- If your command will create new directories or files, first use this tool to run \`ls\` to verify the parent directory exists and is the correct location.
- Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
- Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
- You may specify an optional timeout in milliseconds. By default, your command will timeout after 120000ms (2 minutes).
- When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message.
  - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
- For git commands:
  - Prefer to create a new commit rather than amending an existing commit.
  - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only take destructive operations when they are truly the best approach.
  - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
- Avoid unnecessary \`sleep\` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - If your command is long running and you would like to be notified when it finishes — use \`run_in_background\`. No sleep needed.
  - Do not retry failing commands in a sleep loop — diagnose the root cause.
  - If waiting for a background task you started with \`run_in_background\`, you will be notified when it completes — do not poll.`,
    parameters: bashSchema,
    outputSchema: bashOutputSchema,
    isReadOnly: false,
    isConcurrencySafe: true,
    async validateInput(params, _context) {
      const blockedSleep = detectBlockedSleepPattern(params.command);
      if (blockedSleep) {
        return {
          ok: false,
          message: `Unnecessary \`${blockedSleep}\` detected. Do not sleep between commands that can run immediately — just run them. If your command is long running and you would like to be notified when it finishes — use \`run_in_background\`. No sleep needed.`,
          errorCode: 10,
        };
      }
      return { ok: true };
    },
    async execute(toolCallId, params, context) {
      if (params.run_in_background) {
        return {
          stdout: `Command is running in the background. You will be notified when it completes.`,
          stderr: "",
          exitCode: 0,
          interrupted: false,
          backgroundTaskId: toolCallId,
          dangerouslyDisableSandbox: params.dangerouslyDisableSandbox,
        };
      }

      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", params.command], { cwd });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (params.timeout) {
          timeoutId = setTimeout(() => {
            child.kill("SIGTERM");
          }, params.timeout);
        }

        child.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
        child.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

        child.on("error", (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(err);
        });

        child.on("close", (code, signal) => {
          if (timeoutId) clearTimeout(timeoutId);
          const interrupted = context.abortSignal.aborted || signal === "SIGTERM";
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          resolve({
            stdout,
            stderr,
            exitCode: code,
            interrupted,
            dangerouslyDisableSandbox: params.dangerouslyDisableSandbox,
          });
        });
      });
    },
    formatResult(output) {
      let text = output.stdout;
      if (output.stderr) {
        text += `\nstderr:\n${output.stderr}`;
      }
      if (output.interrupted) {
        text += "\n(interrupted)";
      }
      if (output.backgroundTaskId) {
        text += `\n(background task: ${output.backgroundTaskId})`;
      }
      return [{ type: "text", text: text || "(no output)" }];
    },
  });
}
