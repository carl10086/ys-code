# CLAUDE.md + MetaMessage 机制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ys-code 中完整实现 CLAUDE.md 的发现、解析与注入机制，以 `<system-reminder>` 包裹的 meta user message 形式在每次 API 调用前插入 messages，且不写入持久化历史。

**Architecture:** 新建 `src/utils/claudemd.ts` 负责文件发现/@include/paths 过滤/HTML 注释 stripping；新建 `src/agent/context/user-context.ts` 负责组装 userContext 和 prepend；修改 `AgentLoopConfig` 与 `stream-assistant.ts` 提供默认内置注入；meta 消息通过 `transformContext` 局部变量传递，provider 层零侵入。

**Tech Stack:** Bun, TypeScript, `yaml`, `picomatch`, `marked`（新增依赖），`fs/promises`

**Rules Reminder:**
- 参考 `.claude/rules/code.md`：Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution
- 参考 `.claude/rules/typescript.md`：定义结构体优先用 `interface`，字段要有中文注释

---

## File Structure

- **Create:** `src/utils/claudemd.ts` — 规则文件发现、解析、格式化
- **Create:** `src/agent/context/user-context.ts` — userContext 组装与 prepend
- **Create:** `src/utils/__tests__/claudemd.test.ts` — claudemd 单元测试
- **Create:** `src/agent/context/__tests__/user-context.test.ts` — user-context 单元测试
- **Modify:** `src/agent/types.ts:172-183` — 增加 `disableUserContext` 字段
- **Modify:** `src/agent/stream-assistant.ts:46-65` — 增加默认 `transformContext` fallback
- **Modify:** `src/agent/__tests__/stream-assistant.test.ts` — 补充集成测试

---

### Task 1: 安装 marked 依赖并创建目录

**Files:**
- Modify: `package.json`
- Create dirs: `src/utils/`, `src/utils/__tests__/`, `src/agent/context/`, `src/agent/context/__tests__/

- [ ] **Step 1: 安装 marked**

```bash
bun add marked
```

Expected: `package.json` 中出现 `"marked": "^..."`

- [ ] **Step 2: 创建目录结构**

```bash
mkdir -p src/utils/__tests__ src/agent/context/__tests__
```

Expected: 目录均存在

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock 2>/dev/null || git add package.json
git commit -m "deps: add marked for markdown parsing

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: 实现 `claudemd.ts` — 类型与文件发现

**Files:**
- Create: `src/utils/claudemd.ts`
- Test: `src/utils/__tests__/claudemd.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getMemoryFiles, clearMemoryFilesCache } from "../claudemd.js";

describe("getMemoryFiles", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claudemd-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    clearMemoryFilesCache();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应发现当前目录下的 CLAUDE.md", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Hello");
    const files = await getMemoryFiles(tempDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.path.endsWith("CLAUDE.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/utils/__tests__/claudemd.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现骨架代码**

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test src/utils/__tests__/claudemd.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/claudemd.ts src/utils/__tests__/claudemd.test.ts
git commit -m "feat(claudemd): add basic file discovery and caching

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 实现 `claudemd.ts` — `@include` 递归包含

**Files:**
- Modify: `src/utils/claudemd.ts`
- Modify: `src/utils/__tests__/claudemd.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/utils/__tests__/claudemd.test.ts` 追加：

```typescript
describe("processMemoryFile @include", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claudemd-include-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应递归内联 @include 指向的文件", async () => {
    const mainPath = join(tempDir, "main.md");
    const includePath = join(tempDir, "included.md");
    writeFileSync(mainPath, "Hello\n@./included.md\nWorld");
    writeFileSync(includePath, "Included content");

    const info = await processMemoryFile(mainPath, "project");
    expect(info).not.toBeNull();
    expect(info!.content).toBe("Hello\nIncluded content\nWorld");
  });

  it("应检测循环 include 并终止", async () => {
    const aPath = join(tempDir, "a.md");
    const bPath = join(tempDir, "b.md");
    writeFileSync(aPath, "A\n@./b.md");
    writeFileSync(bPath, "B\n@./a.md");

    const info = await processMemoryFile(aPath, "project");
    expect(info).not.toBeNull();
    expect(info!.content).toContain("A");
    expect(info!.content).toContain("B");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/utils/__tests__/claudemd.test.ts
```

Expected: FAIL（未处理 @include）

- [ ] **Step 3: 实现 @include 解析**

将 `claudemd.ts` 中的 `processMemoryFile` 替换为：

```typescript
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

  const newChain = new Set(includeChain);
  newChain.add(resolvedPath);

  const includeRegex = /^@([~.\/][^\s]+)$/gm;
  const matches = Array.from(rawContent.matchAll(includeRegex));

  let processedContent = rawContent;
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

  return {
    path: relative(cwd, resolvedPath) || resolvedPath,
    fullPath: resolvedPath,
    content: processedContent,
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test src/utils/__tests__/claudemd.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/claudemd.ts src/utils/__tests__/claudemd.test.ts
git commit -m "feat(claudemd): add @include resolution with cycle detection

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 4: 实现 `claudemd.ts` — frontmatter `paths` + HTML 注释 stripping + `getClaudeMds`

**Files:**
- Modify: `src/utils/claudemd.ts`
- Modify: `src/utils/__tests__/claudemd.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/utils/__tests__/claudemd.test.ts` 追加：

```typescript
describe("processMemoryFile frontmatter & stripping", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "claudemd-fm-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("paths 不匹配时应过滤掉文件", async () => {
    const rulePath = join(tempDir, "rule.md");
    writeFileSync(rulePath, "---\npaths:\n  - \"src/**/*.ts\"\n---\nRule content");
    const info = await processMemoryFile(rulePath, "project", { cwd: tempDir });
    expect(info).toBeNull();
  });

  it("应移除 HTML 块级注释", async () => {
    const mdPath = join(tempDir, "comment.md");
    writeFileSync(mdPath, "Hello\n\n<!-- hidden -->\n\nWorld");
    const info = await processMemoryFile(mdPath, "project");
    expect(info).not.toBeNull();
    expect(info!.content).not.toContain("<!-- hidden -->");
    expect(info!.content).toContain("Hello");
    expect(info!.content).toContain("World");
  });

  it("getClaudeMds 应返回格式化字符串", () => {
    const result = getClaudeMds([
      { path: "a.md", fullPath: "/a.md", content: "A", source: "project" },
      { path: "b.md", fullPath: "/b.md", content: "B", source: "project" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain("Contents of a.md:");
    expect(result).toContain("A");
    expect(result).toContain("Contents of b.md:");
    expect(result).toContain("B");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/utils/__tests__/claudemd.test.ts
```

Expected: FAIL（未实现 frontmatter/stripping/getClaudeMds）

- [ ] **Step 3: 实现完整 processMemoryFile 与辅助函数**

将 `claudemd.ts` 中 `processMemoryFile` 到文件末尾替换为：

```typescript
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
        return !/^<!--[\s\S]*?-->$/.test(raw);
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test src/utils/__tests__/claudemd.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/claudemd.ts src/utils/__tests__/claudemd.test.ts
git commit -m "feat(claudemd): add frontmatter paths, html stripping and formatting

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 5: 实现 `user-context.ts`

**Files:**
- Create: `src/agent/context/user-context.ts`
- Test: `src/agent/context/__tests__/user-context.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getUserContext, prependUserContext, clearUserContextCache } from "../user-context.js";
import { clearMemoryFilesCache } from "../../../utils/claudemd.js";
import type { Message } from "../../../core/ai/types.js";

describe("user-context", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "uc-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    clearUserContextCache();
    clearMemoryFilesCache();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prependUserContext 应在 messages 前插入 meta 消息", () => {
    const messages: Message[] = [{ role: "user", content: "hi", timestamp: 1 }];
    const result = prependUserContext(messages, { currentDate: "2026/04/17" });
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    expect(typeof (result[0] as any).content).toBe("string");
    expect((result[0] as any).content).toContain("<system-reminder>");
    expect((result[0] as any).content).toContain("2026/04/17");
  });

  it("getUserContext 应读取 CLAUDE.md", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Rule");
    const ctx = await getUserContext({ cwd: tempDir });
    expect(ctx.claudeMd).toBeDefined();
    expect(ctx.claudeMd).toContain("# Rule");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/agent/context/__tests__/user-context.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 user-context.ts**

```typescript
import type { Message, UserMessage } from "../../core/ai/types.js";
import { getMemoryFiles, filterInjectedMemoryFiles, getClaudeMds } from "../../utils/claudemd.js";

/** 用户上下文 */
export interface UserContext {
  /** CLAUDE.md 聚合内容 */
  claudeMd?: string;
  /** 当前日期 */
  currentDate?: string;
}

const userContextCache = new Map<string, Promise<UserContext>>();

/** memoized 组装 userContext */
export function getUserContext(options?: {
  cwd?: string;
  currentDate?: string;
  disableClaudeMd?: boolean;
}): Promise<UserContext> {
  const cwd = options?.cwd ?? process.cwd();
  const cacheKey = `${cwd}::${options?.disableClaudeMd ?? false}`;
  if (userContextCache.has(cacheKey)) {
    return userContextCache.get(cacheKey)!;
  }
  const promise = _getUserContext(options);
  userContextCache.set(cacheKey, promise);
  return promise;
}

/** 清除缓存（测试用） */
export function clearUserContextCache(): void {
  userContextCache.clear();
}

async function _getUserContext(options?: {
  cwd?: string;
  currentDate?: string;
  disableClaudeMd?: boolean;
}): Promise<UserContext> {
  const context: UserContext = {};

  if (options?.currentDate) {
    context.currentDate = options.currentDate;
  }

  if (!options?.disableClaudeMd) {
    const memoryFiles = await getMemoryFiles(options?.cwd);
    const filtered = filterInjectedMemoryFiles(memoryFiles);
    const claudeMd = getClaudeMds(filtered);
    if (claudeMd) {
      context.claudeMd = claudeMd;
    }
  }

  return context;
}

/** 将 userContext 注入 messages 最前面 */
export function prependUserContext(messages: Message[], context: UserContext): Message[] {
  const entries = Object.entries(context).filter(([, value]) => value && value.trim() !== "");
  if (entries.length === 0) return messages;

  const content = [
    "<system-reminder>",
    "As you answer the user's questions, you can use the following context:",
    ...entries.map(([key, value]) => `# ${key}\n${value}`),
    "",
    "IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
    "</system-reminder>",
    "",
  ].join("\n");

  const metaMessage: UserMessage = {
    role: "user",
    content,
    timestamp: Date.now(),
  };

  return [metaMessage, ...messages];
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test src/agent/context/__tests__/user-context.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/context/user-context.ts src/agent/context/__tests__/user-context.test.ts
git commit -m "feat(agent): add user-context module with prepend logic

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 6: 集成 `AgentLoopConfig` 与 `stream-assistant.ts`

**Files:**
- Modify: `src/agent/types.ts`
- Modify: `src/agent/stream-assistant.ts`
- Modify: `src/agent/__tests__/stream-assistant.test.ts`

- [ ] **Step 1: 写失败测试（stream-assistant 集成）**

在 `src/agent/__tests__/stream-assistant.test.ts` 追加：

```typescript
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearMemoryFilesCache } from "../../utils/claudemd.js";
import { clearUserContextCache } from "../context/user-context.js";

describe("streamAssistantResponse userContext integration", () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sa-uc-"));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    clearMemoryFilesCache();
    clearUserContextCache();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("默认应自动 prepend userContext 到 messages", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Test rules");

    const context = createMockContext();
    const config = createMockConfig();

    let capturedMessages: Message[] | undefined;
    const streamFn = async (_model: any, ctx: any) => {
      capturedMessages = ctx.messages;
      const stream = createAssistantMessageEventStream();
      const final: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.end(final);
      return stream;
    };

    await streamAssistantResponse(context, config, undefined, async () => {}, streamFn as any);

    expect(capturedMessages).toBeDefined();
    expect(capturedMessages!.length).toBeGreaterThan(0);
    expect((capturedMessages![0] as any).role).toBe("user");
    expect((capturedMessages![0] as any).content).toContain("<system-reminder>");
  });

  it("disableUserContext 为 true 时不应 prepend meta message", async () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "# Test rules");

    const context = createMockContext();
    const config = createMockConfig({ disableUserContext: true });

    let capturedMessages: Message[] | undefined;
    const streamFn = async (_model: any, ctx: any) => {
      capturedMessages = ctx.messages;
      const stream = createAssistantMessageEventStream();
      const final: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "anthropic-messages",
        provider: "minimax",
        model: "test-model",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.end(final);
      return stream;
    };

    await streamAssistantResponse(context, config, undefined, async () => {}, streamFn as any);

    expect(capturedMessages).toBeDefined();
    expect(capturedMessages!.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test src/agent/__tests__/stream-assistant.test.ts
```

Expected: FAIL（`disableUserContext` 不存在）

- [ ] **Step 3: 修改 agent types**

在 `src/agent/types.ts` 的 `AgentLoopConfig` 中增加：

```typescript
/** 禁用自动 userContext prepend */
disableUserContext?: boolean;
```

- [ ] **Step 4: 修改 stream-assistant.ts**

在 `src/agent/stream-assistant.ts` 顶部添加 import：

```typescript
import { getUserContext, prependUserContext } from "./context/user-context.js";
import type { Message } from "../core/ai/types.js";
```

将 `let messages = context.messages;` 附近改为：

```typescript
let messages = context.messages;
if (config.transformContext) {
  messages = await config.transformContext(messages, signal);
} else if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  messages = prependUserContext(messages as Message[], userContext) as AgentMessage[];
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
bun test src/agent/__tests__/stream-assistant.test.ts
```

Expected: PASS（含新增集成测试）

- [ ] **Step 6: Commit**

```bash
git add src/agent/types.ts src/agent/stream-assistant.ts src/agent/__tests__/stream-assistant.test.ts
git commit -m "feat(agent): integrate default userContext prepend into stream-assistant

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 7: 全量验证

**Files:**
- 全部改动过的文件

- [ ] **Step 1: 运行完整测试套件**

```bash
bun test
```

Expected: 所有测试 PASS

- [ ] **Step 2: 类型检查**

```bash
bun run typecheck
```

Expected: 无类型错误

- [ ] **Step 3: 最终 Commit（如无错误则跳过，若测试/类型修复则 commit）**

```bash
# 仅当有修复时
# git add ...
# git commit -m "fix: address type errors and test regressions"
```

---

## Self-Review Checklist

**1. Spec coverage：**
- `claudemd.ts` 文件发现 → Task 2
- `@include` 递归包含 → Task 3
- `paths` 条件过滤 → Task 4
- HTML comment stripping → Task 4
- `user-context.ts` / `prependUserContext` → Task 5
- `stream-assistant.ts` 默认集成 → Task 6
- `disableUserContext` 开关 → Task 6

**2. Placeholder scan：**
- 无 TBD/TODO/"implement later"
- 所有步骤含完整代码与命令
- 所有测试含预期输出

**3. Type consistency：**
- `MemoryFileInfo` 在 Task 2 定义，后续任务沿用
- `AgentLoopConfig.disableUserContext` 在 Task 6 定义，与测试一致
- `Message` / `UserMessage` 均来自 `../../core/ai/types.js`
