// src/tools/bash.ts
import { Type, type Static } from "@sinclair/typebox";
import { spawn } from "child_process";
import type { AgentTool } from "../agent/index.js";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

type BashInput = Static<typeof bashSchema>;

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
  return {
    name: "bash",
    label: "Bash",
    description: "Execute a bash command in the working directory.",
    parameters: bashSchema,
    async execute(toolCallId, params, signal) {
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
          if (signal?.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          const output = stdout + (stderr ? `\nstderr:\n${stderr}` : "");
          const isError = code !== 0;

          resolve({
            content: [{ type: "text", text: output || "(no output)" }],
            details: { exitCode: code, command: params.command },
          });
        });
      });
    },
  };
}
