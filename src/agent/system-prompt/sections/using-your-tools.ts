import type { SectionCompute } from "../types.js";

export const compute: SectionCompute = async (context) => {
  if (context.tools.length === 0) {
    return "";
  }

  const lines = [
    "# Using your tools",
    "- Do NOT use the Bash to run commands when a relevant dedicated tool is provided. Using dedicated tools allows the user to better understand and review your work. This is CRITICAL to assisting the user:",
    "  - To read files use Read instead of cat, head, tail, or sed",
    "  - To edit files use Edit instead of sed or awk",
    "  - To create files use Write instead of cat with heredoc or echo redirection",
    "  - To search for files use Glob instead of find or ls",
    "  - To search the content of files, use Grep instead of grep or rg",
    "  - Reserve using the Bash exclusively for system commands and terminal operations that require shell execution. If you are unsure and there is a relevant dedicated tool, default to using the dedicated tool and only fallback on using the Bash tool for these if it is absolutely necessary.",
    "- You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency. However, if some tool calls depend on previous calls to inform dependent values, do NOT call these tools in parallel and instead call these operations sequentially instead.",
  ];

  return lines.join("\n");
};
