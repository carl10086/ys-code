# ReadTool 增强设计文档

## 概述

将 ys-code 的 ReadTool 从简单的文本读取增强到与 claude-code (cc) 对齐的核心文本读取体验。

**目标**: Phase 1 实现文本分页读取 + 行号显示 + 基础校验

## 现状对比

| 维度 | 当前 ys-code | cc FileReadTool |
|------|--------------|-----------------|
| 代码量 | 48 行 | 1185 行 + UI/prompt/limits |
| 分页读取 | ❌ | ✅ offset/limit |
| 行号格式 | ❌ | ✅ cat -n 格式 |
| 路径规范 | ❌ | ✅ expandPath 处理 ~ 和相对路径 |
| 二进制拒绝 | ❌ | ✅ hasBinaryExtension 检查 |
| 设备文件屏蔽 | ❌ | ✅ /dev/*, /proc/self/fd/* |
| Token 预算 | ❌ | ✅ maxTokens 限制 |
| 文件大小限制 | ❌ | ✅ maxSizeBytes 限制 |

## 架构策略

**增强现有 `defineAgentTool`** 而非重构基础设施：

- 在现有架构上逐步添加 `validateInput` 等钩子
- 保持简单性，适合渐进演进
- Phase 2/3 再引入完整基础设施（permissions 系统、render 系统）

## 目录结构

```
src/agent/tools/read/
├── index.ts           # 导出 createReadTool
├── read.ts            # 核心实现
├── validation.ts     # 输入校验（二进制、设备文件等）
├── limits.ts          # 限制配置（maxSizeBytes, maxTokens）
└── types.ts           # 类型定义
```

## 类型定义 (types.ts)

```typescript
// 输入参数
interface ReadInput {
  path: string;           // 文件路径（相对或绝对）
  offset?: number;        // 起始行号（1-indexed）
  limit?: number;         // 最大读取行数
}

// 输出
interface ReadOutput {
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
interface ValidationResult {
  ok: true;
  ok: false;
  message: string;
  errorCode?: number;
}
```

## validateInput 钩子 (validation.ts)

### 1. 路径规范化

```typescript
function expandPath(inputPath: string): string {
  // 处理 ~ 扩展
  // 处理相对路径 → 绝对路径（基于 cwd）
}
```

### 2. 二进制文件拒绝

```typescript
const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'mp4', 'avi', 'mov', 'wmv',
  // ... 更多
]);

function hasBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return BINARY_EXTENSIONS.has(ext);
}
```

### 3. 设备文件屏蔽

```typescript
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
  '/dev/stdin', '/dev/tty', '/dev/console',
  '/dev/stdout', '/dev/stderr',
  '/dev/fd/0', '/dev/fd/1', '/dev/fd/2',
]);

// 额外检查 /proc/self/fd/0-2
```

### 4. 文件不存在处理

- 捕获 ENOENT 错误
- 友好错误消息 + 建议路径

## 限制配置 (limits.ts)

```typescript
interface FileReadingLimits {
  maxTokens: number;      // 输出 token 限制，默认 25000
  maxSizeBytes: number;   // 文件大小限制，默认 256KB
}

export const DEFAULT_LIMITS: FileReadingLimits = {
  maxTokens: 25000,
  maxSizeBytes: 256 * 1024, // 256KB
};
```

## 核心实现 (read.ts)

### 分页读取逻辑

```typescript
// offset 为 1-indexed，转换为 0-indexed
const lineOffset = offset === 0 ? 0 : offset - 1;

// 使用 readFileInRange 或类似机制
const { content, lineCount, totalLines, totalBytes } = await readFileInRange(
  filePath,
  lineOffset,
  limit,
  maxSizeBytes,
);
```

### 行号格式化

```typescript
function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const width = String(startLine + lines.length - 1).length;
  return lines.map((line, i) => {
    const lineNum = String(startLine + i).padStart(width, ' ');
    return `${lineNum}  ${line}`;
  }).join('\n');
}
```

### 执行流程

```
1. validateInput(path)
   ├── 路径规范化 (expandPath)
   ├── 二进制文件检查
   ├── 设备文件检查
   └── 文件大小检查 (stat)
2. checkPermissions(path)
   └── Phase 1: 直接返回 { allowed: true }
3. execute(path, offset, limit)
   ├── 读取文件内容
   ├── 校验 token 数量
   └── 格式化输出
4. formatResult(output)
   └── 返回 LLM 可用的内容块
```

## 错误处理

| 错误类型 | errorCode | 消息 |
|----------|-----------|------|
| 文件不存在 | 1 | "File does not exist. Did you mean ..." |
| 二进制文件 | 4 | "Cannot read binary files. Use appropriate tools ..." |
| 设备文件 | 9 | "Cannot read device file ..." |
| 文件过大 | 6 | "File exceeds max size ..." |

## 依赖

**Phase 1 无需新增依赖**，使用 Node.js 原生模块：
- `fs/promises` - 文件读取
- `path` - 路径处理

## 待实现功能（后续 Phase）

- Phase 2: 图片支持（sharp 依赖）
- Phase 3: PDF/Notebook 支持
- Phase 4: 完整 permissions 系统
- Phase 5: Dedupe 去重机制

## 验收标准

1. ✅ 支持 `offset`/`limit` 分页读取
2. ✅ 输出内容包含 `cat -n` 格式行号
3. ✅ 拒绝二进制文件读取
4. ✅ 拒绝设备文件读取
5. ✅ 路径 `~` 和相对路径正确展开
6. ✅ 文件过大时返回友好错误
7. ✅ 文件不存在时返回友好错误
