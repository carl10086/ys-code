import type { Message, UserMessage } from "../../core/ai/types.js";
import { getMemoryFiles, filterInjectedMemoryFiles, getClaudeMds } from "../../utils/claudemd.js";
import type { AttachmentMessage } from "../attachments/types.js";

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

/** 将 UserContext 转换为 AttachmentMessage 数组 */
export function getUserContextAttachments(context: UserContext): AttachmentMessage[] {
  const entries = Object.entries(context)
    .filter(([, value]) => value && value.trim() !== "")
    .map(([key, value]) => ({ key, value: value! }));

  if (entries.length === 0) return [];

  return [
    {
      role: "attachment",
      attachment: {
        type: "relevant_memories",
        entries,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    },
  ];
}

/** 将 userContext 注入 messages 最前面
 * @deprecated 使用 getUserContextAttachments + normalizeMessages 替代
 */
export function prependUserContext(messages: Message[], context: UserContext): Message[] {
  const attachments = getUserContextAttachments(context);
  // 临时导入避免循环依赖
  const { normalizeMessages } = require("../attachments/normalize.js");
  const normalized = normalizeMessages(attachments as any);
  return [...normalized, ...messages] as Message[];
}
