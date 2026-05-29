import { type as osType, release as osRelease } from "node:os";
import { gitBranchProvider } from "../../../utils/git-branch-provider.js";
import type { SectionCompute } from "../types.js";

function getShellName(shell: string): string {
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  return shell;
}

export const compute: SectionCompute = async (context) => {
  const cwd = context.cwd;
  const isGit = gitBranchProvider.getBranch() !== null;

  const shell = process.env.SHELL || "unknown";
  const shellName = getShellName(shell);

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
