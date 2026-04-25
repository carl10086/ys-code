import type { Entry } from "./entry-types.js";
import type { AgentMessage } from "../agent/types.js";

export class SessionLoader {
  restoreMessages(entries: Entry[]): AgentMessage[] {
    if (entries.length === 0) return [];

    const activeBranch = this.findActiveBranch(entries);

    const messages: AgentMessage[] = [];
    for (const entry of activeBranch) {
      if (entry.type === "header") continue;

      if (entry.type === "compact_boundary") {
        messages.push({
          role: "system",
          content: [{ type: "text", text: entry.summary }],
          timestamp: entry.timestamp,
        } as unknown as AgentMessage);
        continue;
      }

      messages.push(this.entryToMessage(entry));
    }

    return messages;
  }

  private findActiveBranch(entries: Entry[]): Entry[] {
    const byUuid = new Map(entries.map(e => [e.uuid, e]));
    const hasParent = new Set(entries.map(e => e.parentUuid).filter((p): p is string => p !== null));

    const leaves = entries.filter(e => !hasParent.has(e.uuid));
    if (leaves.length === 0) return entries;

    const leaf = leaves[leaves.length - 1];

    const path: Entry[] = [];
    let current: Entry | undefined = leaf;
    while (current) {
      path.unshift(current);
      current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
    }

    return path;
  }

  private entryToMessage(entry: Exclude<Entry, { type: "header" } | { type: "compact_boundary" }>): AgentMessage {
    switch (entry.type) {
      case "user":
        return {
          role: "user",
          content: entry.content,
          timestamp: entry.timestamp,
          isMeta: entry.isMeta,
        } as unknown as AgentMessage;

      case "assistant":
        return {
          role: "assistant",
          content: entry.content,
          model: entry.model,
          usage: entry.usage,
          stopReason: entry.stopReason,
          errorMessage: entry.errorMessage,
          timestamp: entry.timestamp,
        } as unknown as AgentMessage;

      case "toolResult": {
        const msg: Record<string, unknown> = {
          role: "toolResult",
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          content: entry.content,
          isError: entry.isError,
          timestamp: entry.timestamp,
        };
        if (entry.details !== undefined) {
          msg.details = entry.details;
        }
        return msg as unknown as AgentMessage;
      }

      case "attachment":
        return {
          role: "attachment",
          attachment: JSON.parse(entry.content),
          timestamp: entry.timestamp,
        } as unknown as AgentMessage;
    }
  }
}
