// src/agent/system-prompt/types.ts
import type { AgentTool } from "../types.js";
import type { Model } from "../../core/ai/types.js";

/** 构建 system prompt 所需的上下文 */
export interface SystemPromptContext {
  /** 当前工作目录 */
  cwd: string;
  /** 可用工具列表 */
  tools: AgentTool<any, any>[];
  /** 当前模型 */
  model: Model<any>;
  /** memory 文件内容（可选） */
  memoryFiles?: string[];
  /** 其他动态状态（可扩展） */
  [key: string]: unknown;
}

/** Section 计算函数 */
export type SectionCompute = (context: SystemPromptContext) => Promise<string>;

/** Section 定义 */
export interface SystemPromptSection {
  /** section 名称 */
  name: string;
  /** 内容计算函数 */
  compute: SectionCompute;
  /** 缓存键生成函数；返回 undefined 表示 dangerous（每轮强制重算） */
  getCacheKey?: (context: SystemPromptContext) => string | undefined;
}

/** 数组中用于分隔 static 与 dynamic sections 的边界标记 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n\n=== DYNAMIC SYSTEM PROMPT SECTIONS ===\n\n";
