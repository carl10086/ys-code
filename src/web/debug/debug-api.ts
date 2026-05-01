// src/web/debug/debug-api.ts
import type { AgentMessage } from "../../agent/types.js";
import type { Message } from "../../core/ai/index.js";
import { normalizeMessages } from "../../agent/attachments/normalize.js";
import { getDebugAgentSession } from "./debug-context.js";
import { getUserContext, prependUserContext } from "../../agent/context/user-context.js";
import { sections, buildCodingAgentSystemPrompt } from "../../agent/system-prompt/coding-agent.js";
import type { SystemPromptContext } from "../../agent/system-prompt/types.js";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../../agent/system-prompt/types.js";

/**
 * 带调试标记的 LLM 消息
 */
type DebugLlmMessage = Message & {
  _debug?: {
    /** 消息来源分类 */
    source: "meta" | "attachment" | "original";
  };
};

/** System Prompt Section 信息 */
export interface SystemPromptSectionInfo {
  /** section 名称 */
  name: string;
  /** section 类型：static 或 dynamic */
  type: "static" | "dynamic";
  /** section 作用说明 */
  description: string;
  /** section 内容 */
  content: string;
}

/** Section 作用说明（写死） */
const SECTION_DESCRIPTIONS: Record<string, string> = {
  intro: "Agent 身份与基本行为准则",
  system: "系统级约束与核心规则",
  "doing-tasks": "任务执行的工作流程",
  actions: "可用操作类型与用法",
  "using-your-tools": "工具调用规范与格式要求",
  "env-info": "当前环境信息（如目录、模型、工具列表）",
  "output-efficiency": "输出效率与简洁性要求",
  "tone-and-style": "语气与风格指南",
  "summarize-tool-results": "工具结果总结规范",
  "session-specific-guidance": "会话特定的指导信息",
};

/**
 * 构建结构化的 System Prompt Sections
 *
 * createSystemPromptBuilder 会将所有 static sections 放在前面，
 * dynamic sections 放在后面，中间用 SYSTEM_PROMPT_DYNAMIC_BOUNDARY 分隔。
 * 返回的数组按此顺序排列。
 */
async function buildSystemPromptSections(session: any): Promise<SystemPromptSectionInfo[]> {
  const context: SystemPromptContext = {
    cwd: process.cwd(),
    tools: session.tools,
    model: session.model,
  };

  const prompt = await buildCodingAgentSystemPrompt(context);

  // 分离 static 和 dynamic 内容
  const staticContents: string[] = [];
  const dynamicContents: string[] = [];
  let inDynamic = false;

  for (const item of prompt) {
    if (item === SYSTEM_PROMPT_DYNAMIC_BOUNDARY) {
      inDynamic = true;
      continue;
    }
    if (inDynamic) {
      dynamicContents.push(item);
    } else {
      staticContents.push(item);
    }
  }

  // static 和 dynamic sections 按它们在 sections 数组中的出现顺序排列
  const staticSections = sections.filter((s) => s.getCacheKey);
  const dynamicSections = sections.filter((s) => !s.getCacheKey);

  const result: SystemPromptSectionInfo[] = [];

  for (let i = 0; i < staticSections.length; i++) {
    const section = staticSections[i];
    const content = staticContents[i] ?? "";
    const description = SECTION_DESCRIPTIONS[section.name] ?? "";
    result.push({ name: section.name, type: "static", description, content });
  }

  for (let i = 0; i < dynamicSections.length; i++) {
    const section = dynamicSections[i];
    const content = dynamicContents[i] ?? "";
    const description = SECTION_DESCRIPTIONS[section.name] ?? "";
    result.push({ name: section.name, type: "dynamic", description, content });
  }

  return result;
}

/**
 * Debug 上下文响应结构
 */
export interface DebugContextResponse {
  /** 会话 ID */
  sessionId: string;
  /** 模型信息 */
  model: { name: string; provider: string };
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 待执行的工具调用 ID 列表 */
  pendingToolCalls: string[];
  /** 消息总数 */
  messageCount: number;
  /** 原始消息列表 */
  messages: AgentMessage[];
  /** 转换后的 LLM 消息（带调试标记） */
  llmMessages: DebugLlmMessage[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 结构化的 system prompt sections */
  systemPromptSections: SystemPromptSectionInfo[];
  /** 工具名称列表 */
  toolNames: string[];
  /** 数据生成时间戳 */
  timestamp: number;
}

/**
 * 给 LLM 消息打上调试来源标记
 */
function annotateDebugSource(msg: Message): DebugLlmMessage {
  if (msg.role === "user") {
    if (msg.isMeta === true) {
      return { ...msg, _debug: { source: "meta" } };
    }
    if (
      typeof msg.content === "string" &&
      msg.content.includes("<system-reminder>")
    ) {
      return { ...msg, _debug: { source: "attachment" } };
    }
  }
  return { ...msg, _debug: { source: "original" } };
}

/**
 * 构建 Debug 上下文响应
 */
export async function buildDebugContext(): Promise<DebugContextResponse | null> {
  const session = getDebugAgentSession();
  if (!session) {
    return null;
  }

  const messages = [...session.messages];  // 包含 attachment
  let normalized = normalizeMessages(messages);
  // 动态注入 userContext（对齐实际 API 调用逻辑）
  const userContext = await getUserContext({ cwd: process.cwd() });
  normalized = prependUserContext(normalized, userContext);
  const llmMessages = (await session.convertToLlm(normalized)).map(annotateDebugSource);  // 正确的 LLM payload

  const systemPromptSections = await buildSystemPromptSections(session);

  return {
    sessionId: session.sessionId,
    model: {
      name: session.model.name,
      provider: session.model.provider,
    },
    isStreaming: session.isStreaming,
    pendingToolCalls: Array.from(session.pendingToolCalls),
    messageCount: messages.length,
    messages,
    llmMessages,
    systemPrompt: session.getSystemPrompt(),
    systemPromptSections,
    toolNames: session.tools.map((t) => t.name),
    timestamp: Date.now(),
  };
}

/**
 * Debug API 路由处理器
 */
export async function handleDebugAPI(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  // GET /api/debug/context
  if (pathname === "/api/debug/context") {
    try {
      const context = await buildDebugContext();
      if (context === null) {
        return new Response(JSON.stringify({ error: "No active session" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return Response.json(context);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
