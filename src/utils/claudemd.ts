import { promises as fs } from "fs";
import { join, resolve, relative, dirname } from "path";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import picomatch from "picomatch";
import { marked } from "marked";

/** 规则文件优先级（数值越小越靠前） */
export enum MemoryFilePriority {
  MANAGED = 0,
  USER = 1,
  PROJECT = 2,
  LOCAL = 3,
  AUTO_MEM = 4,
  TEAM_MEM = 5,
}

/** 规则文件信息 */
export interface MemoryFileInfo {
  /** 展示路径 */
  path: string;
  /** 磁盘真实路径 */
  fullPath: string;
  /** 处理后的内容 */
  content: string;
  /** 可选描述 */
  description?: string;
  /** 来源标识 */
  source: string;
}

/** 按 cwd 缓存的 promise */
const memoryFilesCache = new Map<string, Promise<MemoryFileInfo[]>>();

/** 获取当前 CWD 下所有生效的 memory 文件（memoized） */
export function getMemoryFiles(cwd: string = process.cwd()): Promise<MemoryFileInfo[]> {
  if (memoryFilesCache.has(cwd)) {
    return memoryFilesCache.get(cwd)!;
  }
  const promise = _getMemoryFiles(cwd);
  memoryFilesCache.set(cwd, promise);
  return promise;
}

/** 清除缓存（测试用） */
export function clearMemoryFilesCache(): void {
  memoryFilesCache.clear();
}

async function _getMemoryFiles(cwd: string): Promise<MemoryFileInfo[]> {
  const files: MemoryFileInfo[] = [];

  const userDir = join(homedir(), ".claude");
  const userFiles = await collectLevelFiles(userDir, cwd, "user");
  files.push(...userFiles);

  const absoluteCwd = resolve(cwd);
  const parts = absoluteCwd.split("/").filter(Boolean);
  let currentPath = "/";

  const rootFiles = await collectLevelFiles(currentPath, cwd, "project");
  files.push(...rootFiles);

  for (const part of parts) {
    currentPath = join(currentPath, part);
    const levelFiles = await collectLevelFiles(currentPath, cwd, "project");
    files.push(...levelFiles);
  }

  const seen = new Map<string, MemoryFileInfo>();
  for (const file of files) {
    seen.set(file.fullPath, file);
  }

  return Array.from(seen.values());
}

async function collectLevelFiles(
  dir: string,
  cwd: string,
  source: string,
): Promise<MemoryFileInfo[]> {
  const files: MemoryFileInfo[] = [];

  const candidates = [
    { path: join(dir, "CLAUDE.md"), src: source },
    { path: join(dir, ".claude", "CLAUDE.md"), src: source },
    { path: join(dir, "CLAUDE.local.md"), src: "local" },
  ];

  for (const c of candidates) {
    if (await fileExists(c.path)) {
      const info = await processMemoryFile(c.path, c.src, { cwd });
      if (info) files.push(info);
    }
  }

  const rulesDir = join(dir, ".claude", "rules");
  if (await dirExists(rulesDir)) {
    const entries = await fs.readdir(rulesDir);
    for (const entry of entries.sort()) {
      if (entry.endsWith(".md")) {
        const rulePath = join(rulesDir, entry);
        const info = await processMemoryFile(rulePath, source, { cwd });
        if (info) files.push(info);
      }
    }
  }

  return files;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** 处理单条 memory 文件（占位） */
export async function processMemoryFile(
  filePath: string,
  source: string,
  options?: { maxDepth?: number; includeChain?: Set<string>; cwd?: string },
): Promise<MemoryFileInfo | null> {
  const cwd = options?.cwd ?? process.cwd();
  let rawContent: string;
  try {
    rawContent = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  return {
    path: relative(cwd, resolve(filePath)) || filePath,
    fullPath: resolve(filePath),
    content: rawContent,
    source,
  };
}

/** 过滤已被注入的文件 */
export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
  injectedPaths?: Set<string>,
): MemoryFileInfo[] {
  if (!injectedPaths || injectedPaths.size === 0) return files;
  return files.filter((f) => !injectedPaths.has(f.fullPath));
}

/** 将 memory 文件列表格式化为 claudeMd 字符串（占位） */
export function getClaudeMds(files: MemoryFileInfo[]): string | null {
  if (files.length === 0) return null;
  return files.map((f) => f.content).join("\n\n");
}
