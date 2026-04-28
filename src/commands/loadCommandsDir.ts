import { readdir, readFile, stat } from "fs/promises";
import { homedir } from "os";
import { join, dirname, normalize } from "path";
import type { PromptCommand, SkillContentBlock } from "./types.js";
import {
  parseFrontmatter,
  parseSkillFrontmatterFields,
} from "../skills/frontmatter.js";
import { logger } from "../utils/logger.js";

/**
 * 从单个 commands 目录加载所有 .md 命令文件
 * 只扫描直接位于目录下的 *.md 文件，忽略子目录
 */
export async function loadCommandsFromDir(
  dirPath: string,
  source: "userSettings" | "projectSettings"
): Promise<PromptCommand[]> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    // 目录不存在或无权限 —— graceful degradation
    return [];
  }

  const mdFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md")
  );

  const commands: PromptCommand[] = [];

  for (const file of mdFiles) {
    const filePath = join(dirPath, file.name);
    const commandName = file.name.replace(/\.md$/, "");

    try {
      const rawContent = await readFile(filePath, { encoding: "utf-8" });
      const { frontmatter, content: markdownContent } =
        parseFrontmatter(rawContent);

      const parsed = parseSkillFrontmatterFields(
        frontmatter,
        markdownContent,
        commandName
      );

      const cmd = createPromptCommand({
        commandName,
        markdownContent,
        source,
        ...parsed,
      });

      commands.push(cmd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to load command from ${filePath}: ${message}`);
    }
  }

  return commands;
}

/**
 * 从 cwd 向上遍历到 git root（或 home），收集所有存在的 .claude/commands/ 目录路径
 * 返回结果按 "cwd → git root" 排序（近者优先）
 */
export async function getProjectCommandDirs(
  cwd: string,
  home: string = homedir()
): Promise<string[]> {
  const dirs: string[] = [];
  const normalizedHome = normalize(home);

  let current = normalize(cwd);

  while (true) {
    // 停止条件：到达 home 目录（不检查 home 本身）
    if (current === normalizedHome) {
      break;
    }

    // 检查当前目录下是否有 .claude/commands
    const cmdsDir = join(current, ".claude", "commands");
    try {
      const s = await stat(cmdsDir);
      if (s.isDirectory()) {
        dirs.push(cmdsDir);
      }
    } catch {
      // 目录不存在，继续向上
    }

    // 停止条件：发现 .git 目录（到达 git root）
    const gitDir = join(current, ".git");
    try {
      const s = await stat(gitDir);
      if (s.isDirectory()) {
        break;
      }
    } catch {
      // 无 .git，继续向上
    }

    // 向上移动到父目录
    const parent = dirname(current);
    if (parent === current) {
      // 到达文件系统根目录
      break;
    }
    current = parent;
  }

  return dirs;
}

/**
 * 创建 PromptCommand
 */
function createPromptCommand({
  commandName,
  displayName,
  description,
  markdownContent,
  allowedTools,
  argumentHint,
  argumentNames,
  whenToUse,
  model,
  disableModelInvocation,
  userInvocable,
  source,
}: {
  commandName: string;
  displayName: string | undefined;
  description: string;
  markdownContent: string;
  allowedTools: string[];
  argumentHint: string | undefined;
  argumentNames: string[];
  whenToUse: string | undefined;
  model: string | undefined;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  source: "userSettings" | "projectSettings";
}): PromptCommand {
  return {
    type: "prompt",
    name: commandName,
    description,
    progressMessage: "running",
    contentLength: markdownContent.length,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    argumentHint,
    whenToUse,
    model,
    disableModelInvocation,
    userInvocable,
    source,
    getPromptForCommand: async (args: string): Promise<SkillContentBlock[]> => {
      let finalContent = markdownContent;

      // 简单的参数替换: $ARGUMENTS 替换为实际参数
      if (args) {
        finalContent = finalContent.replace(/\$ARGUMENTS/g, args);
      }

      return [{ type: "text", text: finalContent }];
    },
  };
}
