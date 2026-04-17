// src/agent/system-prompt/systemPrompt.ts
import type {
  SystemPromptContext,
  SystemPromptSection,
} from "./types.js";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./types.js";
import type { SystemPrompt } from "../../core/ai/index.js";
import { asSystemPrompt } from "../../core/ai/index.js";

/** 缓存条目 */
interface CacheEntry {
  /** 缓存键 */
  cacheKey: string;
  /** 缓存值 */
  value: string;
}

/** 创建 system prompt 构建器 */
export function createSystemPromptBuilder(
  sections: SystemPromptSection[],
): (context: SystemPromptContext) => Promise<SystemPrompt> {
  const cache = new Map<string, CacheEntry>();

  return async (context: SystemPromptContext): Promise<SystemPrompt> => {
    const staticValues: string[] = [];
    for (const section of sections) {
      if (!section.getCacheKey) continue;
      const cacheKey = section.getCacheKey(context);
      if (cacheKey !== undefined) {
        const hit = cache.get(section.name);
        if (hit && hit.cacheKey === cacheKey) {
          staticValues.push(hit.value);
          continue;
        }
      }
      try {
        const value = await section.compute(context);
        if (cacheKey !== undefined) {
          cache.set(section.name, { cacheKey, value });
        }
        staticValues.push(value);
      } catch (err) {
        console.warn(`[system-prompt] section "${section.name}" compute failed:`, err);
        staticValues.push("");
      }
    }

    const dynamicValues: string[] = [];
    for (const section of sections) {
      if (section.getCacheKey) continue;
      try {
        const value = await section.compute(context);
        dynamicValues.push(value);
      } catch (err) {
        console.warn(`[system-prompt] section "${section.name}" compute failed:`, err);
        dynamicValues.push("");
      }
    }

    const result: string[] = [];
    if (staticValues.length > 0) {
      result.push(...staticValues);
    }
    if (staticValues.length > 0 && dynamicValues.length > 0) {
      result.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    }
    if (dynamicValues.length > 0) {
      result.push(...dynamicValues);
    }
    return asSystemPrompt(result);
  };
}

export type { SystemPromptSection };
