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

/** 处理单条 memory 文件 */
export async function processMemoryFile(
  filePath: string,
  source: string,
  options?: { maxDepth?: number; includeChain?: Set<string>; cwd?: string },
): Promise<MemoryFileInfo | null> {
  const maxDepth = options?.maxDepth ?? 10;
  const includeChain = options?.includeChain ?? new Set<string>();
  const cwd = options?.cwd ?? process.cwd();

  const resolvedPath = resolve(filePath);
  if (includeChain.has(resolvedPath)) {
    return null;
  }
  if (includeChain.size >= maxDepth) {
    return null;
  }

  let rawContent: string;
  try {
    rawContent = await fs.readFile(resolvedPath, "utf-8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter(rawContent);

  if (frontmatter?.paths) {
    const patterns = Array.isArray(frontmatter.paths) ? frontmatter.paths : [frontmatter.paths];
    const matches = patterns.some((pattern: string) => {
      return picomatch(pattern, { contains: true, dot: true })(cwd);
    });
    if (!matches) {
      return null;
    }
  }

  const newChain = new Set(includeChain);
  newChain.add(resolvedPath);

  const includeRegex = /^@([~.\/][^\s]+)$/gm;
  const matches = Array.from(body.matchAll(includeRegex));

  let processedContent = body;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const includePathRaw = match[1];
    const includePath = resolveIncludePath(includePathRaw, resolvedPath);
    let replacement = "";
    if (includePath) {
      const nested = await processMemoryFile(includePath, source, {
        maxDepth,
        includeChain: newChain,
        cwd,
      });
      if (nested) {
        replacement = nested.content;
      }
    }
    const before = processedContent.slice(0, match.index);
    const after = processedContent.slice(match.index! + match[0].length);
    processedContent = before + replacement + after;
  }

  const strippedContent = stripHtmlBlockComments(processedContent);

  return {
    path: relative(cwd, resolvedPath) || resolvedPath,
    fullPath: resolvedPath,
    content: strippedContent,
    source,
  };
}

/** 解析 include 路径 */
function resolveIncludePath(raw: string, baseFile: string): string | null {
  if (raw.startsWith("~/")) {
    return resolve(join(homedir(), raw.slice(2)));
  }
  if (raw.startsWith("/")) {
    return resolve(raw);
  }
  const baseDir = dirname(baseFile);
  return resolve(join(baseDir, raw));
}

/** 解析 YAML frontmatter */
function parseFrontmatter(content: string): { frontmatter: Record<string, any> | null; body: string } {
  if (!content.startsWith("---\n")) {
    return { frontmatter: null, body: content };
  }
  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }
  const yamlText = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5);
  try {
    const frontmatter = parseYaml(yamlText) as Record<string, any>;
    return { frontmatter, body };
  } catch {
    return { frontmatter: null, body: content };
  }
}

/** 移除 HTML 块级注释 */
function stripHtmlBlockComments(content: string): string {
  try {
    const tokens = marked.lexer(content);
    const filtered = tokens.filter((token: any) => {
      if (token.type === "html") {
        const raw = token.raw?.trim() || "";
        return !/^<!--[\s\S]*?-->$/m.test(raw);
      }
      return true;
    });
    return filtered.map((token: any) => token.raw || "").join("");
  } catch {
    return content;
  }
}

/** 过滤已被注入的文件 */
export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
  injectedPaths?: Set<string>,
): MemoryFileInfo[] {
  if (!injectedPaths || injectedPaths.size === 0) return files;
  return files.filter((f) => !injectedPaths.has(f.fullPath));
}

const MEMORY_INSTRUCTION_PROMPT = `The following additional context was automatically retrieved. It may or may not be relevant to the user's request. You should use it if it is relevant, and ignore it if it is not.`;

/** 将 memory 文件列表格式化为 claudeMd 字符串 */
export function getClaudeMds(files: MemoryFileInfo[]): string | null {
  if (files.length === 0) return null;
  const parts = [MEMORY_INSTRUCTION_PROMPT, ""];
  for (const file of files) {
    const desc = file.description ? ` (${file.description})` : "";
    parts.push(`Contents of ${file.path}${desc}:`);
    parts.push(file.content);
    parts.push("");
  }
  return parts.join("\n");
}
