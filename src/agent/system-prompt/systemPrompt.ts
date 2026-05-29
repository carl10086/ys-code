// src/agent/system-prompt/systemPrompt.ts
import type {
  SystemPromptContext,
  SystemPromptSection,
} from "./types.js";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./types.js";
import type { SystemPrompt } from "../../core/ai/index.js";
import { asSystemPrompt } from "../../core/ai/index.js";
import { logger } from "../../utils/logger.js";

/** 缓存条目 */
interface CacheEntry {
  cacheKey: string;
  value: string;
}

/** 全局共享缓存 */
const globalCache = new Map<string, CacheEntry>();

let nextBuilderId = 0;

/** 清除 system prompt section 缓存 */
export function clearSystemPromptCache(): void {
  globalCache.clear();
}

/** 计算单个 section，失败时返回空字符串并记录日志 */
async function tryCompute(
  section: SystemPromptSection,
  context: SystemPromptContext,
): Promise<string> {
  try {
    return await section.compute(context);
  } catch (err) {
    logger.warn("[system-prompt] section compute failed", {
      section: section.name,
      error: String(err),
    });
    return "";
  }
}

/** 创建 system prompt 构建器 */
export function createSystemPromptBuilder(
  sections: SystemPromptSection[],
): (context: SystemPromptContext) => Promise<SystemPrompt> {
  const builderId = `builder-${nextBuilderId++}`;

  return async (context: SystemPromptContext): Promise<SystemPrompt> => {
    const staticValues: string[] = [];
    const dynamicValues: string[] = [];

    for (const section of sections) {
      const cacheKey = section.getCacheKey?.(context);
      const cacheName = `${builderId}:${section.name}`;

      if (cacheKey !== undefined) {
        const hit = globalCache.get(cacheName);
        if (hit && hit.cacheKey === cacheKey) {
          staticValues.push(hit.value);
          continue;
        }
        const value = await tryCompute(section, context);
        globalCache.set(cacheName, { cacheKey, value });
        staticValues.push(value);
      } else {
        dynamicValues.push(await tryCompute(section, context));
      }
    }

    const result: string[] = [];
    if (staticValues.length > 0) result.push(...staticValues);
    if (staticValues.length > 0 && dynamicValues.length > 0) {
      result.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    }
    if (dynamicValues.length > 0) result.push(...dynamicValues);
    return asSystemPrompt(result);
  };
}

export type { SystemPromptSection };
