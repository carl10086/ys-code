// src/agent/system-prompt/coding-agent.ts
import type { SystemPrompt } from "../../core/ai/index.js";
import { createSystemPromptBuilder } from "./systemPrompt.js";
import type { SystemPromptContext, SystemPromptSection } from "./types.js";
import * as intro from "./sections/intro.js";
import * as system from "./sections/system.js";
import * as doingTasks from "./sections/doing-tasks.js";
import * as actions from "./sections/actions.js";
import * as usingYourTools from "./sections/using-your-tools.js";
import * as envInfo from "./sections/env-info.js";
import * as outputEfficiency from "./sections/output-efficiency.js";
import * as toneAndStyle from "./sections/tone-and-style.js";
import * as summarizeToolResults from "./sections/summarize-tool-results.js";
import * as sessionSpecificGuidance from "./sections/session-specific-guidance.js";

/** 创建 static section（带缓存键） */
function staticSection(name: string, compute: (context: SystemPromptContext) => Promise<string>): SystemPromptSection {
  return { name, compute, getCacheKey: () => name };
}

/** 创建 dynamic section（每轮强制重算） */
function dynamicSection(name: string, compute: (context: SystemPromptContext) => Promise<string>): SystemPromptSection {
  return { name, compute };
}

const sections: SystemPromptSection[] = [
  staticSection("intro", intro.compute),
  staticSection("system", system.compute),
  staticSection("doing-tasks", doingTasks.compute),
  staticSection("actions", actions.compute),
  dynamicSection("using-your-tools", usingYourTools.compute),
  dynamicSection("env-info", envInfo.compute),
  staticSection("output-efficiency", outputEfficiency.compute),
  staticSection("tone-and-style", toneAndStyle.compute),
  staticSection("summarize-tool-results", summarizeToolResults.compute),
  staticSection("session-specific-guidance", sessionSpecificGuidance.compute),
];

/** 构建 coding-agent 的 system prompt */
export function buildCodingAgentSystemPrompt(
  context: SystemPromptContext,
): Promise<SystemPrompt> {
  return createSystemPromptBuilder(sections)(context);
}
