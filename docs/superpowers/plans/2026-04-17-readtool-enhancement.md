# ReadTool 增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标:** 将 ys-code 的 ReadTool 从简单文本读取增强到 cc 对齐的文本读取体验（Phase 1: 文本 + 行号 + 基础校验）

**架构:** 增强现有 `defineAgentTool`，不重构基础设施。新增 `validation.ts`、`limits.ts`、`types.ts` 分层实现。

**技术栈:** Node.js 原生模块（fs/promises, path），无需新依赖。

---

## 文件结构

```
src/agent/tools/read/
├── index.ts           # 导出 createReadTool
├── read.ts            # 核心实现
├── validation.ts     # 输入校验（expandPath, 二进制, 设备文件）
├── limits.ts          # 限制配置
└── types.ts           # 类型定义

需修改:
src/agent/define-agent-tool.ts    # validateInput 返回值增强（支持 errorCode）
src/agent/tools/index.ts          # 更新导出
```

---

## 实现任务

### Task 1: 创建 types.ts — 类型定义

**文件:** 创建 `src/agent/tools/read/types.ts`

- [ ] **Step 1: 创建文件**

```typescript
// 输入参数
export interface ReadInput {
  path: string;           // 文件路径（相对或绝对）
  offset?: number;        // 起始行号（1-indexed）
  limit?: number;         // 最大读取行数
}

// 输出
export interface ReadOutput {
  type: 'text';
  file: {
    filePath: string;      // 完整绝对路径
    content: string;       // 带行号的内容
    numLines: number;       // 本次返回的行数
    startLine: number;      // 起始行号
    totalLines: number;     // 文件总行数
  };
}

// 校验结果
export interface ValidationResult {
  ok: true;
}

export interface ValidationError {
  ok: false;
  message: string;
  errorCode: number;
}
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/tools/read/types.ts
git commit -m "feat(read): add types.ts with ReadInput, ReadOutput, ValidationResult"
```

---

### Task 2: 创建 limits.ts — 限制配置

**文件:** 创建 `src/agent/tools/read/limits.ts`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * Read tool output limits
 */
export interface FileReadingLimits {
  /** 输出 token 限制，默认 25000 */
  maxTokens: number;
  /** 文件大小限制，默认 256KB */
  maxSizeBytes: number;
}

/** 默认限制配置 */
export const DEFAULT_LIMITS: FileReadingLimits = {
  maxTokens: 25000,
  maxSizeBytes: 256 * 1024, // 256KB
};
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/tools/read/limits.ts
git commit -m "feat(read): add limits.ts with DEFAULT_LIMITS"
```

---

### Task 3: 创建 validation.ts — 校验逻辑

**文件:** 创建 `src/agent/tools/read/validation.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { stat } from 'fs/promises';
import type { ValidationError } from './types.js';
import { DEFAULT_LIMITS } from './limits.js';

/** 二进制文件扩展名集合 */
const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'bmp', 'tiff', 'tif',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'tgz', 'iso',
  'mp3', 'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v', 'mpeg', 'mpg',
  'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'pyc', 'pyo', 'class', 'jar', 'war', 'ear', 'node', 'wasm', 'rlib',
  'sqlite', 'sqlite3', 'db', 'mdb', 'idx',
  'psd', 'ai', 'eps', 'sketch', 'fig', 'xd', 'blend', '3ds', 'max',
  'swf', 'fla', 'lockb', 'data',
]);

/** 设备文件路径集合 */
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
]);

/**
 * 展开路径（处理 ~ 和相对路径）
 */
export function expandPath(inputPath: string, cwd?: string): string {
  const baseDir = cwd ?? process.cwd();

  // 处理 ~ 扩展
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }

  // 处理绝对路径
  if (isAbsolute(inputPath)) {
    return inputPath;
  }

  // 处理相对路径
  return resolve(baseDir, inputPath);
}

/**
 * 检查是否有二进制文件扩展名
 */
export function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * 检查是否是屏蔽的设备文件
 */
export function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
  // 检查 /proc/self/fd/0-2
  if (
    filePath.startsWith('/proc/') &&
    (filePath.endsWith('/fd/0') ||
      filePath.endsWith('/fd/1') ||
      filePath.endsWith('/fd/2'))
  ) {
    return true;
  }
  return false;
}

/**
 * 校验输入参数
 */
export async function validateReadInput(
  path: string,
  cwd?: string,
): Promise<{ ok: true } | ValidationError> {
  // 1. 路径规范化
  const fullPath = expandPath(path, cwd);

  // 2. 设备文件检查
  if (isBlockedDevicePath(fullPath)) {
    return {
      ok: false,
      message: `Cannot read '${path}': this device file would block or produce infinite output.`,
      errorCode: 9,
    };
  }

  // 3. 二进制文件检查
  if (hasBinaryExtension(fullPath)) {
    return {
      ok: false,
      message: `Cannot read binary file '${path}'. Use appropriate tools for binary file analysis.`,
      errorCode: 4,
    };
  }

  // 4. 文件存在性和大小检查
  try {
    const stats = await stat(fullPath);
    if (stats.size > DEFAULT_LIMITS.maxSizeBytes) {
      return {
        ok: false,
        message: `File content (${stats.size} bytes) exceeds maximum allowed size (${DEFAULT_LIMITS.maxSizeBytes} bytes). Use offset and limit parameters to read specific portions.`,
        errorCode: 6,
      };
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {
        ok: false,
        message: `File does not exist: ${fullPath}`,
        errorCode: 1,
      };
    }
    throw error;
  }

  return { ok: true };
}
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/tools/read/validation.ts
git commit -m "feat(read): add validation.ts with expandPath, binary check, device check"
```

---

### Task 4: 修改 define-agent-tool.ts — 增强 validateInput 返回值

**文件:** 修改 `src/agent/define-agent-tool.ts:7-11`

- [ ] **Step 1: 修改 validateInput 返回值类型**

当前代码：
```typescript
validateInput?: async () => ({ ok: true }),
```

修改为：
```typescript
validateInput?: (
  params: Static<TParameters>,
  context: ToolUseContext,
) => Promise<{ ok: true } | { ok: false; message: string; errorCode?: number }>,
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/define-agent-tool.ts
git commit -m "feat(tools): enhance validateInput to support errorCode"
```

---

### Task 5: 创建 read.ts — 核心实现

**文件:** 创建 `src/agent/tools/read/read.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { readFile } from 'fs/promises';
import { defineAgentTool } from '../define-agent-tool.js';
import type { AgentTool } from '../types.js';
import type { ReadInput, ReadOutput } from './types.js';
import { DEFAULT_LIMITS } from './limits.js';
import { expandPath, validateReadInput } from './validation.js';

const readSchema = {
  type: 'object' as const,
  properties: {
    path: { type: 'string', description: '文件路径（相对或绝对路径）' },
    offset: { type: 'number', description: '起始行号（1-indexed）' },
    limit: { type: 'number', description: '最大读取行数' },
  },
  required: ['path'],
};

const readOutputSchema = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' },
    file: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        content: { type: 'string' },
        numLines: { type: 'number' },
        startLine: { type: 'number' },
        totalLines: { type: 'number' },
      },
    },
  },
};

/**
 * 添加行号格式化
 */
function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(width, ' ');
      return `${lineNum}  ${line}`;
    })
    .join('\n');
}

export function createReadTool(cwd: string): AgentTool {
  return defineAgentTool({
    name: 'read',
    label: 'Read',
    description: 'Read the contents of a file.',
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    validateInput: async (params) => {
      const result = await validateReadInput(params.path, cwd);
      return result;
    },

    execute: async (toolCallId, params) => {
      const fullPath = expandPath(params.path, cwd);
      const offset = params.offset ?? 1;
      const lineOffset = offset === 0 ? 0 : offset - 1;

      // 读取文件
      let text = await readFile(fullPath, 'utf-8');
      const allLines = text.split('\n');
      const totalLines = allLines.length;

      // 分页
      const start = Math.max(0, lineOffset);
      const end = params.limit !== undefined ? start + params.limit : totalLines;
      const selectedLines = allLines.slice(start, end);
      text = selectedLines.join('\n');

      // 格式化行号
      const content = addLineNumbers(text, offset);
      const numLines = selectedLines.length;

      const output: ReadOutput = {
        type: 'text',
        file: {
          filePath: fullPath,
          content,
          numLines,
          startLine: offset,
          totalLines,
        },
      };

      return output;
    },

    formatResult: (output: ReadOutput) => {
      return [{ type: 'text' as const, text: output.file.content }];
    },
  });
}
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/tools/read/read.ts
git commit -m "feat(read): add read.ts core implementation with line numbers"
```

---

### Task 6: 创建 index.ts — 导出

**文件:** 创建 `src/agent/tools/read/index.ts`

- [ ] **Step 1: 创建文件**

```typescript
export { createReadTool } from './read.js';
export type { ReadInput, ReadOutput, ValidationResult, ValidationError } from './types.js';
export { DEFAULT_LIMITS } from './limits.js';
export { expandPath, validateReadInput, hasBinaryExtension, isBlockedDevicePath } from './validation.js';
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/tools/read/index.ts
git commit -m "feat(read): add index.ts exports"
```

---

### Task 7: 更新 tools/index.ts

**文件:** 修改 `src/agent/tools/index.ts`

- [ ] **Step 1: 查看并修改导出**

将：
```typescript
export { createReadTool } from './read.js';
```

修改为：
```typescript
export { createReadTool } from './read/index.js';
```

- [ ] **Step 2: 提交**
```bash
git add src/agent/tools/index.ts
git commit -m "refactor(tools): update read tool export path"
```

---

### Task 8: 删除旧的 read.ts

**文件:** 删除 `src/agent/tools/read.ts`

- [ ] **Step 1: 删除文件**
```bash
git rm src/agent/tools/read.ts
```

- [ ] **Step 2: 提交**
```bash
git commit -m "refactor(read): remove old monolithic read.ts"
```

---

### Task 9: 验证实现

**验证点:**

- [ ] 1. 运行 `bun run typecheck` 确保无类型错误
- [ ] 2. 检查验收标准：
  - offset/limit 分页读取 ✅
  - cat -n 行号格式 ✅
  - 二进制文件拒绝 ✅
  - 设备文件拒绝 ✅
  - 路径 ~ 和相对路径展开 ✅
  - 文件过大友好错误 ✅
  - 文件不存在友好错误 ✅

---

## 验收标准对照

| 标准 | 实现位置 |
|------|----------|
| 支持 offset/limit 分页读取 | read.ts execute() |
| 输出内容包含 cat -n 格式行号 | read.ts addLineNumbers() |
| 拒绝二进制文件读取 | validation.ts hasBinaryExtension() |
| 拒绝设备文件读取 | validation.ts isBlockedDevicePath() |
| 路径 ~ 和相对路径正确展开 | validation.ts expandPath() |
| 文件过大时返回友好错误 | validation.ts validateReadInput() |
| 文件不存在时返回友好错误 | validation.ts validateReadInput() |

---

## 错误码对照

| 错误类型 | errorCode | 位置 |
|----------|-----------|------|
| 文件不存在 | 1 | validation.ts |
| 文件过大 | 6 | validation.ts |
| 二进制文件 | 4 | validation.ts |
| 设备文件 | 9 | validation.ts |
