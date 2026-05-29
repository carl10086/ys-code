import { existsSync } from "node:fs";
import { type as osType, release as osRelease } from "node:os";
import type { SectionCompute } from "../types.js";

export const compute: SectionCompute = async (context) => {
  const cwd = context.cwd;
  const isGit = existsSync(`${cwd}/.git`) || existsSync(`${cwd}/../.git`);

  const shell = process.env.SHELL || "unknown";
  const shellName = shell.includes("zsh")
    ? "zsh"
    : shell.includes("bash")
      ? "bash"
      : shell;

  const envItems = [
    `Primary working directory: ${cwd}`,
    `Is a git repository: ${isGit ? "Yes" : "No"}`,
    `Platform: ${process.platform}`,
    `Shell: ${shellName}`,
    `OS Version: ${osType()} ${osRelease()}`,
    `You are powered by the model ${context.model.id}.`,
  ];

  return [
    "# Environment",
    "You have been invoked in the following environment: ",
    ...envItems.map((item) => `  - ${item}`),
  ].join("\n");
};
