import { SessionStorage } from "./session-storage.js";
import { SessionLoader } from "./session-loader.js";
import { CompactTrigger } from "./compact/trigger.js";
import type { AgentMessage } from "../agent/types.js";
import type { Entry, UserEntry, AssistantEntry, ToolResultEntry, CompactBoundaryEntry } from "./entry-types.js";

/** SessionManager 配置 */
export interface SessionManagerConfig {
  /** 存储目录 */
  baseDir: string;
  /** 当前工作目录 */
  cwd: string;
  /** Compact 阈值（可选，默认不启用） */
  compactThreshold?: number;
}

/** 会话管理器 —— 统一入口 */
export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly loader: SessionLoader;
  private readonly compactTrigger?: CompactTrigger;
  private _sessionId: string;
  private _filePath: string;
  private _lastUuid: string | null = null;

  /** 会话 ID */
  get sessionId(): string {
    return this._sessionId;
  }

  /** 当前会话文件路径 */
  get filePath(): string {
    return this._filePath;
  }

  constructor(config: SessionManagerConfig, restoreFromFile?: { sessionId: string; filePath: string; entries: Entry[] }) {
    this.storage = new SessionStorage(config.baseDir);
    this.loader = new SessionLoader();
    if (config.compactThreshold) {
      this.compactTrigger = new CompactTrigger({ threshold: config.compactThreshold });
    }

    if (restoreFromFile) {
      this._sessionId = restoreFromFile.sessionId;
      this._filePath = restoreFromFile.filePath;
      this._lastUuid = this.findLastUuid(restoreFromFile.entries);
    } else {
      this._sessionId = crypto.randomUUID();
      this._filePath = this.storage.createSession(this._sessionId, config.cwd);
      this._lastUuid = this.findLastUuid(this.storage.readAllEntries(this._filePath));
    }
  }

  /** 追加消息并持久化 */
  appendMessage(message: AgentMessage): void {
    // attachment 消息动态生成，不需要持久化（对齐 CC 设计）
    if (message.role === "attachment") return;

    const entry = this.messageToEntry(message);
    this.storage.appendEntry(this._filePath, entry);
    this._lastUuid = entry.uuid;
  }

  /** 追加 compact 后的消息，并让 restore 从最新 compact boundary 开始恢复 active context */
  replaceMessages(messages: AgentMessage[]): void {
    let parentUuid = this._lastUuid;
    for (const message of messages) {
      if (message.role === "attachment") continue;

      const entry = this.messageToEntry(message, parentUuid);
      this.storage.appendEntry(this._filePath, entry);
      parentUuid = entry.uuid;
    }
    this._lastUuid = parentUuid;
  }

  /** 恢复消息（从磁盘加载活跃分支） */
  restoreMessages(): AgentMessage[] {
    const entries = this.storage.readAllEntries(this._filePath);
    return this.loader.restoreMessages(entries);
  }

  /** 如果需要则触发 compact */
  compactIfNeeded(): void {
    if (!this.compactTrigger) return;

    const messages = this.restoreMessages();
    if (this.compactTrigger.shouldCompact(messages)) {
      const boundary = this.compactTrigger.createCompactBoundary(messages, this._lastUuid);
      this.storage.appendEntry(this._filePath, boundary);
      this._lastUuid = boundary.uuid;
    }
  }

  /** 恢复最近会话（静态工厂） */
  static restoreLatest(config: SessionManagerConfig): SessionManager | null {
    const storage = new SessionStorage(config.baseDir);
    const latestFile = storage.findLatestSessionFile();
    if (!latestFile) return null;

    const entries = storage.readAllEntries(latestFile);
    const header = entries.find((e): e is Extract<Entry, { type: "header" }> => e.type === "header");
    if (!header) return null;

    return new SessionManager(config, {
      sessionId: header.sessionId,
      filePath: latestFile,
      entries,
    });
  }

  /** 将 AgentMessage 转换为 Entry */
  private messageToEntry(message: AgentMessage, parentUuid: string | null = this._lastUuid): Entry {
    const uuid = (message as { uuid?: string }).uuid ?? crypto.randomUUID();
    const timestamp = message.timestamp ?? Date.now();

    switch (message.role) {
      case "compact_boundary": {
        const metadata = message.compactMetadata;
        return {
          type: "compact_boundary",
          uuid,
          parentUuid,
          timestamp,
          summary: "",
          tokensBefore: metadata.preTokens,
          tokensAfter: metadata.postTokens ?? 0,
          compactMetadata: metadata,
        } as CompactBoundaryEntry;
      }

      case "user":
        return {
          type: "user",
          uuid,
          parentUuid,
          timestamp,
          content: message.content,
          isMeta: message.isMeta,
        } as UserEntry;

      case "assistant":
        return {
          type: "assistant",
          uuid,
          parentUuid,
          timestamp,
          content: message.content,
          model: message.model ?? "unknown",
          usage: message.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: message.stopReason ?? "stop",
          errorMessage: message.errorMessage,
        } as AssistantEntry;

      case "toolResult":
        return {
          type: "toolResult",
          uuid,
          parentUuid,
          timestamp,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          content: message.content,
          isError: message.isError,
          details: message.details,
        } as ToolResultEntry;

      default:
        throw new Error(`Unsupported message role: ${(message as any).role}`);
    }
  }

  /** 从条目列表找到最后一个叶子节点的 UUID */
  private findLastUuid(entries: Entry[]): string | null {
    const hasParent = new Set(entries.map(e => e.parentUuid).filter((p): p is string => p !== null));
    const leaves = entries.filter(e => !hasParent.has(e.uuid));
    return leaves.length > 0 ? leaves[leaves.length - 1].uuid : null;
  }
}
