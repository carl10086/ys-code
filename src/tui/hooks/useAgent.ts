import { useEffect, useMemo, useRef, useState } from "react";
import { Agent } from "../../agent/agent.js";
import type { AgentEvent, AgentMessage, AgentState, AgentTool } from "../../agent/types.js";
import { asSystemPrompt } from "../../core/ai/index.js";
import type { Model } from "../../core/ai/index.js";
import type { UIMessage } from "../types.js";

export interface UseAgentOptions {
  /** 系统提示词 */
  systemPrompt: string;
  /** 使用的模型 */
  model: Model<any>;
  /** API Key */
  apiKey: string | undefined;
  /** 工具列表 */
  tools: AgentTool<any>[];
}

export interface UseAgentResult {
  /** Agent 实例 */
  agent: Agent;
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
  const agent = useMemo(() => {
    return new Agent({
      systemPrompt: async () => asSystemPrompt([options.systemPrompt]),
      initialState: {
        model: options.model,
        thinkingLevel: "medium",
        tools: options.tools,
      },
      getApiKey: () => options.apiKey,
    });
  }, []);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false);
  const toolStartTimes = useRef<Map<string, number>>(new Map());
  const turnStartTime = useRef<number>(0);

  useEffect(() => {
    return agent.subscribe((event) => {
      setMessages((prev) => {
        const next = [...prev];
        switch (event.type) {
          case "turn_start": {
            turnStartTime.current = Date.now();
            next.push({ type: "assistant_start" });
            break;
          }
          case "message_update": {
            const ae = event.assistantMessageEvent;
            if (ae.type === "thinking_delta") {
              const last = next[next.length - 1];
              if (last && last.type === "thinking") {
                last.text += ae.delta;
              } else {
                next.push({ type: "thinking", text: ae.delta });
              }
            } else if (ae.type === "text_delta") {
              const last = next[next.length - 1];
              if (last && last.type === "text") {
                last.text += ae.delta;
              } else {
                next.push({ type: "text", text: ae.delta });
              }
            }
            break;
          }
          case "tool_execution_start": {
            toolStartTimes.current.set(event.toolCallId, Date.now());
            next.push({ type: "tool_start", toolName: event.toolName, args: event.args });
            break;
          }
          case "tool_execution_end": {
            const startTime = toolStartTimes.current.get(event.toolCallId) ?? Date.now();
            toolStartTimes.current.delete(event.toolCallId);
            const summary = event.isError
              ? String((event.result as any)?.content?.[0]?.text ?? "error")
              : String((event.result as any)?.content?.[0]?.text ?? "");
            next.push({
              type: "tool_end",
              toolName: event.toolName,
              isError: event.isError,
              summary: summary || "done",
              timeMs: Date.now() - startTime,
            });
            break;
          }
          case "turn_end": {
            const elapsed = Date.now() - turnStartTime.current;
            if (event.message.role === "assistant") {
              const usage = event.message.usage;
              next.push({
                type: "assistant_end",
                tokens: usage.totalTokens,
                cost: usage.cost.total,
                timeMs: elapsed,
              });
            }
            break;
          }
        }
        return next;
      });
      setShouldScrollToBottom(true);
    });
  }, [agent]);

  return {
    agent,
    messages,
    shouldScrollToBottom,
    markScrolled: () => setShouldScrollToBottom(false),
    appendUserMessage: (text: string) => {
      setMessages((prev) => [...prev, { type: "user", text }]);
      setShouldScrollToBottom(true);
    },
  };
}
