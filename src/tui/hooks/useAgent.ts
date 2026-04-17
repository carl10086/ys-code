import { useEffect, useMemo, useState } from "react";
import { AgentSession } from "../../agent/session.js";
import type { AgentSessionEvent } from "../../agent/session.js";
import type { Model } from "../../core/ai/index.js";
import type { UIMessage } from "../types.js";

export interface UseAgentOptions {
  /** 系统提示词 */
  systemPrompt: string;
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
}

export function useAgent(options: UseAgentOptions): UseAgentResult {
  const session = useMemo(() => {
    return new AgentSession({
      cwd: process.cwd(),
      model: options.model,
      apiKey: options.apiKey,
      systemPrompt: options.systemPrompt,
    });
  }, []);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);

  useEffect(() => {
    return session.subscribe((event: AgentSessionEvent) => {
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
            });
            break;
          }
          case "turn_end": {
            next.push({
              type: "assistant_end",
              tokens: event.tokens,
              cost: event.cost,
              timeMs: event.timeMs,
            });
            break;
          }
        }
        return next;
      });
      setShouldScrollToBottom(true);
    });
  }, [session]);

  return {
    session,
    messages,
    shouldScrollToBottom,
    markScrolled: () => setShouldScrollToBottom(false),
    appendUserMessage: (text: string) => {
      setMessages((prev) => [...prev, { type: "user", text }]);
      setShouldScrollToBottom(true);
    },
  };
}
