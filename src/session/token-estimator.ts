import type { AgentMessage } from "../agent/types.js";

/** Token 估算器
 * Phase 1: 使用字符数估算（1 token ≈ 4 字符）
 * Phase 2: 可替换为 tiktoken 精确计算
 */
export class TokenEstimator {
  /** 估算消息列表的总 token 数 */
  estimate(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateMessage(msg);
    }
    return total;
  }

  private estimateMessage(msg: AgentMessage): number {
    let tokens = 4; // 基础开销：每条消息约 4 token

    if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult" || (msg as any).role === "system") {
      tokens += this.estimateContent((msg as any).content);
    }

    return tokens;
  }

  private estimateContent(content: unknown): number {
    if (typeof content === "string") {
      return Math.ceil(content.length / 4);
    }

    if (Array.isArray(content)) {
      return content.reduce((sum, item) => {
        if (typeof item === "string") return sum + Math.ceil(item.length / 4);
        if (item && typeof item === "object") {
          if ("text" in item && typeof item.text === "string") {
            return sum + Math.ceil(item.text.length / 4);
          }
          if ("thinking" in item && typeof item.thinking === "string") {
            return sum + Math.ceil(item.thinking.length / 4);
          }
        }
        return sum + 1;
      }, 0);
    }

    return 1;
  }
}
