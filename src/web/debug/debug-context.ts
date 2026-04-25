// src/web/debug/debug-context.ts
import type { AgentSession } from "../../agent/session.js";

let currentAgentSession: AgentSession | undefined;

/**
 * 设置当前调试用的 AgentSession
 * 由 App.tsx 在 session 创建/重置时调用
 */
export function setDebugAgentSession(session: AgentSession | undefined): void {
  currentAgentSession = session;
}

/**
 * 获取当前调试用的 AgentSession
 * 由 Debug API 路由调用
 */
export function getDebugAgentSession(): AgentSession | undefined {
  return currentAgentSession;
}
