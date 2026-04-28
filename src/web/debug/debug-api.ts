// src/web/debug/debug-api.ts
import type { AgentMessage } from "../../agent/types.js";
import type { Message } from "../../core/ai/index.js";
import { normalizeMessages } from "../../agent/attachments/normalize.js";
import { getDebugAgentSession } from "./debug-context.js";
import { getUserContext, prependUserContext } from "../../agent/context/user-context.js";

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
  /** 转换后的 LLM 消息 */
  llmMessages: Message[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 工具名称列表 */
  toolNames: string[];
  /** 数据生成时间戳 */
  timestamp: number;
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
  const llmMessages = await session.convertToLlm(normalized);  // 正确的 LLM payload

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
