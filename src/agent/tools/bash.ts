// src/agent/tools/bash.ts
import { Type, type Static } from "@sinclair/typebox";
import { spawn } from "child_process";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

const bashOutputSchema = Type.Object({
  stdout: Type.String(),
  stderr: Type.String(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
});

type BashInput = Static<typeof bashSchema>;
type BashOutput = Static<typeof bashOutputSchema>;

export function createBashTool(cwd: string): AgentTool<typeof bashSchema, BashOutput> {
  return defineAgentTool({
    name: "bash",
    label: "Bash",
    description: "Execute a bash command in the working directory.",
    parameters: bashSchema,
    outputSchema: bashOutputSchema,
    isReadOnly: false,
    isConcurrencySafe: true,
    async execute(toolCallId, params, context) {
      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", params.command], { cwd });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (params.timeout) {
          timeoutId = setTimeout(() => {
            child.kill("SIGTERM");
          }, params.timeout * 1000);
        }

        child.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
        child.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

        child.on("error", (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(err);
        });

        child.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (context.abortSignal.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          resolve({ stdout, stderr, exitCode: code });
        });
      });
    },
    formatResult(output) {
      const text = output.stdout + (output.stderr ? `\nstderr:\n${output.stderr}` : "");
      return [{ type: "text", text: text || "(no output)" }];
    },
  });
}
