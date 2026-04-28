import type { Message, UserMessage } from "../../core/ai/types.js";
import { getMemoryFiles, filterInjectedMemoryFiles, getClaudeMds } from "../../utils/claudemd.js";

/** 用户上下文 */
export interface UserContext {
  /** CLAUDE.md 聚合内容 */
  claudeMd?: string;
  /** 当前日期 */
  currentDate?: string;
  /** Git 分支名称 */
  gitBranch?: string;
}

const userContextCache = new Map<string, Promise<UserContext>>();

/** memoized 组装 userContext */
export function getUserContext(options?: {
  cwd?: string;
  currentDate?: string;
  disableClaudeMd?: boolean;
}): Promise<UserContext> {
  const cwd = options?.cwd ?? process.cwd();
  const cacheKey = `${cwd}::${options?.disableClaudeMd ?? false}`;
  if (userContextCache.has(cacheKey)) {
    return userContextCache.get(cacheKey)!;
  }
  const promise = _getUserContext(options);
  userContextCache.set(cacheKey, promise);
  return promise;
}

/** 清除缓存（测试用） */
export function clearUserContextCache(): void {
  userContextCache.clear();
}

async function _getUserContext(options?: {
  cwd?: string;
  currentDate?: string;
  disableClaudeMd?: boolean;
}): Promise<UserContext> {
  const context: UserContext = {};

  if (options?.currentDate) {
    context.currentDate = options.currentDate;
  }

  if (!options?.disableClaudeMd) {
    const memoryFiles = await getMemoryFiles(options?.cwd);
    const filtered = filterInjectedMemoryFiles(memoryFiles);
    const claudeMd = getClaudeMds(filtered);
    if (claudeMd) {
      context.claudeMd = claudeMd;
    }
  }

  const { gitBranchProvider } = await import("../../utils/git-branch-provider.js");
  context.gitBranch = gitBranchProvider.getBranch() ?? undefined;

  return context;
}

/** 将 userContext 动态注入 messages 最前面 */
export function prependUserContext(messages: Message[], context: UserContext): Message[] {
  const entries = Object.entries(context)
    .filter(([, value]) => value && value.trim() !== "")
    .map(([key, value]) => ({ key, value: value! }));

  if (entries.length === 0) return messages;

  const content = [
    "<system-reminder>",
    "As you answer the user's questions, you can use the following context:",
    ...entries.map((e) => `# ${e.key}\n${e.value}`),
    "",
    "IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
    "</system-reminder>",
    "",
  ].join("\n");

  const metaMessage: UserMessage = {
    role: "user",
    content,
    timestamp: Date.now(),
    isMeta: true,
  };

  return [metaMessage, ...messages];
}
