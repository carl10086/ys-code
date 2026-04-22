import { SessionStorage } from "./session-storage.js";
import { SessionLoader } from "./session-loader.js";
import { CompactTrigger } from "./compact.js";
import type { AgentMessage } from "../agent/types.js";
import type { Entry, UserEntry, AssistantEntry, ToolResultEntry } from "./entry-types.js";

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
    const entry = this.messageToEntry(message);
    this.storage.appendEntry(this._filePath, entry);
    this._lastUuid = entry.uuid;
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
  private messageToEntry(message: AgentMessage): Entry {
    const uuid = crypto.randomUUID();
    const parentUuid = this._lastUuid;
    const timestamp = message.timestamp ?? Date.now();

    switch (message.role) {
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
