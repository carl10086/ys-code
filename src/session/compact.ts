import { TokenEstimator } from "./token-estimator.js";
import type { CompactBoundaryEntry } from "./entry-types.js";
import type { AgentMessage } from "../agent/types.js";

/** Compact 配置 */
export interface CompactConfig {
  /** 触发阈值（token 数） */
  threshold: number;
}

/** Compact 触发器 */
export class CompactTrigger {
  private readonly estimator: TokenEstimator;
  private readonly threshold: number;

  constructor(config: CompactConfig) {
    this.estimator = new TokenEstimator();
    this.threshold = config.threshold;
  }

  /** 判断是否应触发 compact */
  shouldCompact(messages: AgentMessage[]): boolean {
    const tokens = this.estimator.estimate(messages);
    return tokens >= this.threshold;
  }

  /** 创建 compact_boundary 条目（简化版：取前几条消息拼接作为摘要） */
  createCompactBoundary(messages: AgentMessage[], lastUuid: string | null): CompactBoundaryEntry {
    const tokensBefore = this.estimator.estimate(messages);

    // 简化摘要：取前 3 条消息的前 200 字符
    const summaryParts: string[] = [];
    for (let i = 0; i < Math.min(3, messages.length); i++) {
      const msg = messages[i];
      let text = "";
      if (msg.role === "user" || msg.role === "assistant") {
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map(c => c.text)
            .join(" ");
        }
      }
      if (text) {
        summaryParts.push(`${msg.role}: ${text.slice(0, 200)}`);
      }
    }

    const summary = summaryParts.join("\n") || "Previous conversation summary";
    const tokensAfter = this.estimator.estimate([
      { role: "system", content: [{ type: "text", text: summary }], timestamp: Date.now() } as unknown as AgentMessage,
    ]);

    return {
      type: "compact_boundary",
      uuid: crypto.randomUUID(),
      parentUuid: lastUuid,
      timestamp: Date.now(),
      summary,
      tokensBefore,
      tokensAfter,
    };
  }
}
