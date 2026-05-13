import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSession } from "../../agent/session.js";
import type { AgentSessionEvent } from "../../agent/session.js";
import type { AgentMessage } from "../../agent/types.js";
import type { Model, ToolCall, Usage } from "../../core/ai/index.js";
import type { UIMessage } from "../types.js";

// 对齐 cc utils/tokens.ts:getCurrentUsage —— 取消息列表中最后一条 assistant 的 usage（不累加）
export function findLastUsage(messages: readonly AgentMessage[]): Usage | null {
  const last = messages.findLast((m) => m.role === "assistant");
  return last ? last.usage : null;
}

function extractText(
  content: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>,
): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * 从 AgentMessage[] 派生完整的 UIMessage[]
 * 用于 turn_end 时 reconciliation，确保 compact 后 UI 与 Agent 状态一致
 */
export function deriveUIMessages(messages: readonly AgentMessage[]): UIMessage[] {
  const uiMessages: UIMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    switch (msg.role) {
      case "user": {
        if (msg.isMeta) continue; // meta 消息 UI 隐藏
        const text = extractText(msg.content);
        uiMessages.push({ type: "user", text });
        break;
      }

      case "assistant": {
        uiMessages.push({ type: "assistant_start" });

        // 非 toolCall 内容（text, thinking）
        for (const content of msg.content) {
          if (content.type === "text") {
            uiMessages.push({ type: "text", text: content.text });
          } else if (content.type === "thinking") {
            uiMessages.push({ type: "thinking", text: content.thinking });
          }
        }

        // toolCall + toolResult 配对
        const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
        for (let j = 0; j < toolCalls.length && i + 1 + j < messages.length; j++) {
          const toolCall = toolCalls[j];
          const nextMsg = messages[i + 1 + j];

          uiMessages.push({ type: "tool_start", toolName: toolCall.name, args: toolCall.arguments });

          if (nextMsg.role === "toolResult") {
            const summary = extractText(nextMsg.content);
            uiMessages.push({
              type: "tool_end",
              toolName: nextMsg.toolName,
              isError: nextMsg.isError,
              summary: summary || "done",
              timeMs: 0,
              renderData: undefined,
            });
          }
        }
        i += toolCalls.length;

        uiMessages.push({
          type: "assistant_end",
          tokens: msg.usage.totalTokens,
          cost: msg.usage.cost.total,
          timeMs: 0,
        });
        break;
      }

      case "toolResult": {
        // 孤立的 toolResult（正常情况下不应出现，防御性处理）
        const summary = extractText(msg.content);
        uiMessages.push({
          type: "tool_end",
          toolName: msg.toolName,
          isError: msg.isError,
          summary: summary || "done",
          timeMs: 0,
          renderData: undefined,
        });
        break;
      }

      case "attachment":
      case "compact_boundary":
        // UI 不显示
        break;
    }
  }

  return uiMessages;
}

export interface UseAgentOptions {
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
}

export interface UseAgentResult {
  /** AgentSession 实例 */
  session: AgentSession;
  /** UI 消息列表 */
  messages: UIMessage[];
  /** 是否应自动滚动到底部 */
  shouldScrollToBottom: boolean;
  /** 标记滚动已执行 */
  markScrolled: () => void;
  /** 添加用户消息到列表 */
  appendUserMessage: (text: string) => void;
  /** 添加系统消息到列表 */
  appendSystemMessage: (text: string) => void;
  /** 重置 session，创建新实例并清空消息 */
  resetSession: () => void;
  /** 最近一次 API 响应的 usage（对齐 cc StatusLine 的 getCurrentUsage） */
  lastUsage: Usage | null;
  /** 累计费用（美元） */
  cost: number;
}

export function useAgent(options: UseAgentOptions): UseAgentResult {
  const sessionRef = useRef<AgentSession>(
    new AgentSession({
      cwd: process.cwd(),
      model: options.model,
      apiKey: options.apiKey,
      mcpConfigPath: process.cwd(),
    })
  );
  // 使用 useState 管理 session，确保 resetSession 时组件重渲染
  const [sessionState, setSessionState] = useState<AgentSession>(sessionRef.current);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);
  const [lastUsage, setLastUsage] = useState<Usage | null>(() =>
    findLastUsage(sessionRef.current.messages)
  );
  const [cost, setCost] = useState(0);
  const unsubscribeRef = useRef<() => void>(null);
  const messagesLengthAtTurnStartRef = useRef(0);

  const subscribeToSession = useCallback((session: AgentSession) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "turn_end") {
        // Compact 检测：如果消息总量减少，说明发生了 compact，需要重新派生
        const hasCompacted =
          sessionRef.current.messages.length < messagesLengthAtTurnStartRef.current;
        if (hasCompacted) {
          setMessages(deriveUIMessages(sessionRef.current.messages));
        } else {
          setMessages((prev) => {
            const next = [...prev];
            next.push({
              type: "assistant_end",
              tokens: event.tokens,
              cost: event.cost,
              timeMs: event.timeMs,
            });
            return next;
          });
        }
        // 对齐 cc utils/tokens.ts:getCurrentUsage —— 最近一次 API usage，不累加
        setLastUsage(findLastUsage(sessionRef.current.messages));
        setCost((prev) => prev + event.cost);
      } else {
        if (event.type === "turn_start") {
          messagesLengthAtTurnStartRef.current = sessionRef.current.messages.length;
        }
        setMessages((prev) => {
          const next = [...prev];
          switch (event.type) {
            case "turn_start": {
              next.push({ type: "assistant_start" });
              break;
            }
            case "thinking_delta": {
              const last = next[next.length - 1];
              if (last && last.type === "thinking") {
                last.text += event.text;
              } else {
                next.push({ type: "thinking", text: event.text });
              }
              break;
            }
            case "answer_delta": {
              const last = next[next.length - 1];
              if (last && last.type === "text") {
                last.text += event.text;
              } else {
                next.push({ type: "text", text: event.text });
              }
              break;
            }
            case "tool_start": {
              next.push({ type: "tool_start", toolName: event.toolName, args: event.args });
              break;
            }
            case "tool_end": {
              next.push({
                type: "tool_end",
                toolName: event.toolName,
                isError: event.isError,
                summary: event.summary,
                timeMs: event.timeMs,
                renderData: event.renderData,
              });
              break;
            }
          }
          return next;
        });
      }
      setShouldScrollToBottom(true);
    });
  }, []);

  useEffect(() => {
    subscribeToSession(sessionRef.current);
    return () => {
      unsubscribeRef.current?.();
    };
  }, [subscribeToSession]);

  const resetSession = useCallback(() => {
    unsubscribeRef.current?.();
    sessionRef.current = new AgentSession({
      cwd: process.cwd(),
      model: options.model,
      apiKey: options.apiKey,
    });
    // AgentSession 构造函数已生成 sessionId，无需再调用 regenerateSessionId
    subscribeToSession(sessionRef.current);
    // 更新 sessionState 触发重渲染，确保 App 中的 session 引用是最新的
    setSessionState(sessionRef.current);
    setMessages([]);
    setLastUsage(null);
    setCost(0);
  }, [options.model, options.apiKey, subscribeToSession]);

  return {
    session: sessionState,
    messages,
    shouldScrollToBottom,
    markScrolled: () => setShouldScrollToBottom(false),
    appendUserMessage: (text: string) => {
      setMessages((prev) => [...prev, { type: "user", text }]);
      setShouldScrollToBottom(true);
    },
    appendSystemMessage: (text: string) => {
      setMessages((prev) => [...prev, { type: "system", text }]);
      // 不自动滚动 system 消息，避免长文本被推出可视区域
    },
    resetSession,
    lastUsage,
    cost,
  };
}
