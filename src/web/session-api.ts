// src/web/session-api.ts

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  Entry,
  HeaderEntry,
  AssistantEntry,
} from "../session/entry-types.js";
import { logger } from "../utils/logger.js";

/** 单个文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Session 列表项 */
export interface SessionListItem {
  /** 文件名 */
  fileName: string;
  /** 会话 ID */
  sessionId: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 总条目数 */
  entryCount: number;
  /** 消息条目数（user + assistant + toolResult） */
  messageCount: number;
  /** 是否存在 compact_boundary */
  hasCompact: boolean;
}

/** Session 详情响应 */
export interface SessionDetailResponse {
  /** 文件名 */
  fileName: string;
  /** 文件头信息 */
  header: HeaderEntry;
  /** 所有条目 */
  entries: Entry[];
  /** 统计信息 */
  stats: {
    /** 用户消息数 */
    userCount: number;
    /** Assistant 消息数 */
    assistantCount: number;
    /** 工具结果数 */
    toolResultCount: number;
    /** Compact 边界数 */
    compactCount: number;
    /** 总 token 数 */
    totalTokens: number;
  };
}

/**
 * 获取 session 目录路径
 * 优先从环境变量 YS_SESSION_DIR 获取，否则默认 ~/.ys-code/sessions
 */
export function getSessionDir(): string {
  if (process.env.YS_SESSION_DIR) {
    return process.env.YS_SESSION_DIR;
  }
  return path.join(os.homedir(), ".ys-code", "sessions");
}

/**
 * 快速统计文件中的换行符数量（用于估算总行数）
 */
function countLines(content: string): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      count++;
    }
  }
  // 如果最后一行没有换行符，也算一行
  if (content.length > 0 && content[content.length - 1] !== "\n") {
    count++;
  }
  return count;
}

/**
 * 快速检查是否存在 compact_boundary 类型
 * 扫描前几行和最后一行
 */
function hasCompactBoundary(content: string): boolean {
  const lines = content.split("\n");
  // 检查前 20 行
  const headLines = lines.slice(0, 20);
  // 检查最后 5 行
  const tailLines = lines.slice(-5);
  const checkLines = [...headLines, ...tailLines];

  for (const line of checkLines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "compact_boundary") {
        return true;
      }
    } catch {
      // 忽略解析失败的行
    }
  }
  return false;
}

/**
 * 统计消息数量（user + assistant + toolResult）
 */
function countMessages(content: string): number {
  const lines = content.split("\n");
  let count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (
        entry.type === "user" ||
        entry.type === "assistant" ||
        entry.type === "toolResult"
      ) {
        count++;
      }
    } catch {
      // 忽略解析失败的行
    }
  }
  return count;
}

/**
 * 读取 session 目录下的所有 .jsonl 文件列表
 */
export function listSessions(): SessionListItem[] {
  const sessionDir = getSessionDir();

  if (!fs.existsSync(sessionDir)) {
    return [];
  }

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  const items: SessionListItem[] = [];

  for (const fileName of files) {
    const filePath = path.join(sessionDir, fileName);

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      // 读取文件内容用于统计
      const content = fs.readFileSync(filePath, "utf-8");

      // 读取第一行作为 header
      const firstNewline = content.indexOf("\n");
      const headerLine =
        firstNewline >= 0 ? content.slice(0, firstNewline) : content;

      let header: HeaderEntry | undefined;
      try {
        header = JSON.parse(headerLine) as HeaderEntry;
      } catch {
        logger.warn("Failed to parse session header", { fileName });
        continue;
      }

      const entryCount = countLines(content);
      const messageCount = countMessages(content);
      const hasCompact = hasCompactBoundary(content);

      items.push({
        fileName,
        sessionId: header.sessionId || fileName,
        createdAt: header.timestamp || stat.mtimeMs,
        entryCount,
        messageCount,
        hasCompact,
      });
    } catch (err) {
      logger.error("Failed to read session file", {
        fileName,
        error: String(err),
      });
    }
  }

  // 按 createdAt 倒序排列
  items.sort((a, b) => b.createdAt - a.createdAt);

  return items;
}

/**
 * 校验文件名是否合法
 */
function isValidFileName(filename: string): boolean {
  if (!filename.endsWith(".jsonl")) {
    return false;
  }
  // 禁止路径穿越字符
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return false;
  }
  return true;
}

/**
 * 获取单个 session 详情
 * @param filename 文件名
 * @returns SessionDetailResponse 或 null（文件不存在）
 */
export function getSession(filename: string): SessionDetailResponse | null {
  if (!isValidFileName(filename)) {
    logger.warn("Invalid session filename", { filename });
    return null;
  }

  const sessionDir = getSessionDir();
  const filePath = path.join(sessionDir, filename);

  // 确保解析后的路径仍在 session 目录内（防止路径穿越）
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(sessionDir);
  if (!resolvedPath.startsWith(resolvedDir)) {
    logger.warn("Path traversal detected", { filename, resolvedPath });
    return null;
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return null;
  }

  // 检查文件大小
  if (stat.size > MAX_FILE_SIZE) {
    logger.warn("Session file too large", { filename, size: stat.size });
    throw new FileTooLargeError(`File ${filename} exceeds 50MB limit`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const entries: Entry[] = [];
  let header: HeaderEntry | undefined;

  let userCount = 0;
  let assistantCount = 0;
  let toolResultCount = 0;
  let compactCount = 0;
  let totalTokens = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Entry;
      entries.push(entry);

      // 统计各类型数量
      switch (entry.type) {
        case "header":
          if (!header) {
            header = entry as HeaderEntry;
          }
          break;
        case "user":
          userCount++;
          break;
        case "assistant": {
          assistantCount++;
          const assistant = entry as AssistantEntry;
          if (assistant.usage) {
            totalTokens += assistant.usage.totalTokens || 0;
          }
          break;
        }
        case "toolResult":
          toolResultCount++;
          break;
        case "compact_boundary":
          compactCount++;
          break;
      }
    } catch (err) {
      logger.warn("Skipping corrupted line in session file", {
        filename,
        line: line.slice(0, 100),
      });
    }
  }

  if (!header) {
    logger.warn("No header found in session file", { filename });
    return null;
  }

  return {
    fileName: filename,
    header,
    entries,
    stats: {
      userCount,
      assistantCount,
      toolResultCount,
      compactCount,
      totalTokens,
    },
  };
}

/**
 * 文件过大错误
 */
export class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileTooLargeError";
  }
}

/**
 * Session API 路由处理器
 */
export function handleSessionAPI(req: Request): Response {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // 只处理 GET 请求
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/sessions - 列表
  if (pathname === "/api/sessions") {
    try {
      const sessions = listSessions();
      return Response.json(sessions);
    } catch (err) {
      logger.error("Failed to list sessions", { error: String(err) });
      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // GET /api/sessions/:filename - 详情
  if (pathname.startsWith("/api/sessions/")) {
    const filename = pathname.slice("/api/sessions/".length);

    try {
      const session = getSession(filename);
      if (session === null) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return Response.json(session);
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        return new Response(
          JSON.stringify({ error: "Payload Too Large", message: err.message }),
          { status: 413, headers: { "Content-Type": "application/json" } }
        );
      }
      logger.error("Failed to get session", {
        filename,
        error: String(err),
      });
      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
