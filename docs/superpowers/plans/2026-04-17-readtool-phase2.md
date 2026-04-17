# ReadTool Phase 2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 基础上实现图片、PDF、Notebook 支持，并对齐 claude-code 核心机制

**Architecture:** 按文件类型分发给专用处理器（image.ts/pdf.ts/notebook.ts），使用 discriminatedUnion 统一输出类型，sharp 动态导入处理图片

**Tech Stack:** TypeScript, Bun, sharp (npm), poppler-utils (系统)

---

## 文件结构

```
src/agent/tools/read/
├── index.ts           # 导出（新增 image/pdf/notebook 导出）
├── read.ts            # 核心调度（重写为按类型分发）
├── types.ts           # 扩展为 discriminatedUnion
├── limits.ts          # 新增 token 预算和 API 限制常量
├── validation.ts      # 新增 PDF pages 参数校验
├── image.ts           # 图片处理（sharp 动态导入）
├── pdf.ts             # PDF 处理（系统命令）
└── notebook.ts        # Notebook 解析（原生 JSON）
```

---

## 前置准备

### 安装系统依赖

```bash
# macOS
brew install poppler

# Ubuntu/Debian  
apt-get install poppler-utils
```

### 安装 npm 依赖

```bash
bun add sharp
```

---

## Task 1: 扩展 types.ts — discriminatedUnion 输出类型

**Files:**
- Modify: `src/agent/tools/read/types.ts`

- [ ] **Step 1: 重写输出类型为 discriminatedUnion**

```typescript
// 文本输出
export interface TextOutput {
  type: 'text';
  file: {
    filePath: string;      // 完整绝对路径
    content: string;       // 带行号的内容
    numLines: number;       // 本次返回的行数
    startLine: number;      // 起始行号
    totalLines: number;     // 文件总行数
  };
}

// 图片输出
export interface ImageOutput {
  type: 'image';
  file: {
    base64: string;         // Base64 编码的图片数据
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    originalSize: number;   // 原始文件大小（字节）
    dimensions?: {           // 图片尺寸信息（可选）
      originalWidth: number;
      originalHeight: number;
      displayWidth?: number;
      displayHeight?: number;
    };
  };
}

// PDF 输出
export interface PDFOutput {
  type: 'pdf';
  file: {
    filePath: string;       // PDF 文件路径
    base64: string;         // Base64 编码的 PDF 数据
    originalSize: number;   // 原始文件大小
  };
}

// Notebook 输出
export interface NotebookOutput {
  type: 'notebook';
  file: {
    filePath: string;       // Notebook 文件路径
    cells: unknown[];       // 单元格数组
  };
}

// PDF 分页提取输出
export interface PartsOutput {
  type: 'parts';
  file: {
    filePath: string;       // PDF 文件路径
    originalSize: number;   // 原始文件大小
    count: number;          // 提取的页数
    outputDir: string;      // 输出目录（包含 page-01.jpg 等）
  };
}

// 文件未变更（dedupe）
export interface FileUnchangedOutput {
  type: 'file_unchanged';
  file: {
    filePath: string;
  };
}

// 统一输出类型
export type ReadOutput =
  | TextOutput
  | ImageOutput
  | PDFOutput
  | NotebookOutput
  | PartsOutput
  | FileUnchangedOutput;

// 输入参数（保持不变）
export interface ReadInput {
  path: string;           // 文件路径（相对或绝对）
  offset?: number;        // 起始行号（1-indexed）
  limit?: number;         // 最大读取行数
  pages?: string;         // PDF 页面范围（如 "1-5"）
}

// 校验结果（保持不变）
export interface ValidationResult {
  ok: true;
}

export interface ValidationError {
  ok: false;
  message: string;
  errorCode?: number;
}
```

- [ ] **Step 2: 验证类型正确性**

```bash
bun run typecheck
```

Expected: PASS，无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/types.ts
git commit -m "feat(read): extend types to discriminatedUnion for image/pdf/notebook"
```

---

## Task 2: 扩展 limits.ts — API 限制常量

**Files:**
- Modify: `src/agent/tools/read/limits.ts`

- [ ] **Step 1: 添加 API 限制常量**

```typescript
/**
 * Read tool output limits and API constraints
 */

// 图片限制
export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5 MB
export const IMAGE_TARGET_RAW_SIZE = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4; // 3.75 MB
export const IMAGE_MAX_WIDTH = 2000;
export const IMAGE_MAX_HEIGHT = 2000;

// PDF 限制
export const PDF_TARGET_RAW_SIZE = 20 * 1024 * 1024; // 20 MB
export const PDF_MAX_EXTRACT_SIZE = 100 * 1024 * 1024; // 100 MB
export const PDF_MAX_PAGES_PER_READ = 20;
export const PDF_AT_MENTION_INLINE_THRESHOLD = 10;
export const API_PDF_MAX_PAGES = 100;

// 媒体限制
export const API_MAX_MEDIA_PER_REQUEST = 100;

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

/** Token 超出错误 */
export class MaxFileReadTokenExceededError extends Error {
  constructor(
    public tokenCount: number,
    public maxTokens: number,
  ) {
    super(
      `File content (${tokenCount} tokens) exceeds maximum allowed tokens (${maxTokens}). ` +
      `Use offset and limit parameters to read specific portions of the file, ` +
      `or search for specific content instead of reading the whole file.`,
    );
    this.name = 'MaxFileReadTokenExceededError';
  }
}

/**
 * 粗略估算文本 token 数
 * 简单估算：每 4 个字符约 1 个 token
 */
export function roughTokenCount(content: string): number {
  return Math.ceil(content.length / 4);
}
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/limits.ts
git commit -m "feat(read): add API limits constants and token counting"
```

---

## Task 3: 创建 image.ts — 图片处理

**Files:**
- Create: `src/agent/tools/read/image.ts`

- [ ] **Step 1: 创建图片处理模块**

```typescript
import { readFile } from 'fs/promises';
import type { ImageOutput } from './types.js';
import {
  API_IMAGE_MAX_BASE64_SIZE,
  DEFAULT_LIMITS,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
  MaxFileReadTokenExceededError,
} from './limits.js';

export type ImageDimensions = {
  originalWidth: number;
  originalHeight: number;
  displayWidth?: number;
  displayHeight?: number;
};

export type ImageResult = {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  originalSize: number;
  dimensions?: ImageDimensions;
};

/** 支持的图片扩展名 */
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** 检测图片格式 */
export function detectImageFormat(buffer: Buffer): string {
  if (buffer.length < 4) return 'png';
  
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'jpeg';
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'gif';
  // WebP: 52 49 46 46 (RIFF header, then WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'webp';
  
  return 'png';
}

/** 估算图片 token 数 */
function estimateImageTokens(base64Length: number): number {
  return Math.ceil(base64Length * 0.125);
}

/**
 * 使用 sharp 调整图片大小和压缩
 * 动态导入 sharp，失败时提供降级方案
 */
async function resizeWithSharp(
  imageBuffer: Buffer,
  format: string,
): Promise<{ buffer: Buffer; format: string; dimensions?: ImageDimensions }> {
  try {
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default || sharpModule;
    
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;
    const actualFormat = metadata.format || format;
    
    // 标准化格式名称
    const normalizedFormat = actualFormat === 'jpg' ? 'jpeg' : actualFormat;
    
    // 如果尺寸和大小都在限制内，直接返回
    if (
      imageBuffer.length <= IMAGE_TARGET_RAW_SIZE &&
      originalWidth <= IMAGE_MAX_WIDTH &&
      originalHeight <= IMAGE_MAX_HEIGHT
    ) {
      return {
        buffer: imageBuffer,
        format: normalizedFormat,
        dimensions: {
          originalWidth,
          originalHeight,
          displayWidth: originalWidth,
          displayHeight: originalHeight,
        },
      };
    }
    
    // 需要调整大小或压缩
    let processed = image;
    
    // 如果尺寸超限，先 resize
    if (originalWidth > IMAGE_MAX_WIDTH || originalHeight > IMAGE_MAX_HEIGHT) {
      processed = processed.resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    
    // 根据格式压缩
    let resultBuffer: Buffer;
    if (normalizedFormat === 'png') {
      resultBuffer = await processed.png({ compressionLevel: 9, palette: true }).toBuffer();
      // 如果还是太大，转为 JPEG
      if (resultBuffer.length > IMAGE_TARGET_RAW_SIZE) {
        resultBuffer = await processed.jpeg({ quality: 80 }).toBuffer();
      }
    } else {
      // JPEG/WebP/GIF 使用 quality 压缩
      const quality = imageBuffer.length > IMAGE_TARGET_RAW_SIZE * 2 ? 60 : 80;
      resultBuffer = await processed.jpeg({ quality }).toBuffer();
    }
    
    const newMetadata = await sharp(resultBuffer).metadata();
    
    return {
      buffer: resultBuffer,
      format: resultBuffer.length > IMAGE_TARGET_RAW_SIZE ? 'jpeg' : normalizedFormat,
      dimensions: {
        originalWidth,
        originalHeight,
        displayWidth: newMetadata.width || originalWidth,
        displayHeight: newMetadata.height || originalHeight,
      },
    };
  } catch (error) {
    // sharp 导入失败，返回原始 buffer
    console.warn('sharp not available, using original image');
    return { buffer: imageBuffer, format };
  }
}

/**
 * Aggressive 压缩（当标准压缩仍超出 token 预算时）
 */
async function compressAggressively(
  imageBuffer: Buffer,
  maxTokens: number,
  format: string,
): Promise<{ buffer: Buffer; format: string }> {
  try {
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default || sharpModule;
    
    const maxBase64Size = Math.floor(maxTokens / 0.125);
    
    // 逐步降低质量直到满足要求
    const qualities = [60, 40, 20];
    for (const quality of qualities) {
      const compressed = await sharp(imageBuffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      
      const base64 = compressed.toString('base64');
      if (base64.length <= maxBase64Size) {
        return { buffer: compressed, format: 'jpeg' };
      }
    }
    
    // 最后手段：极低质量
    const fallback = await sharp(imageBuffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 10 })
      .toBuffer();
    
    return { buffer: fallback, format: 'jpeg' };
  } catch {
    // sharp 不可用，无法压缩
    throw new Error('Image exceeds token budget and sharp is not available for compression');
  }
}

/**
 * 读取图片文件
 */
export async function readImage(
  filePath: string,
  maxTokens: number = DEFAULT_LIMITS.maxTokens,
): Promise<ImageOutput> {
  const imageBuffer = await readFile(filePath);
  const originalSize = imageBuffer.length;
  
  if (originalSize === 0) {
    throw new Error(`Image file is empty: ${filePath}`);
  }
  
  const detectedFormat = detectImageFormat(imageBuffer);
  
  // 标准 resize
  const resized = await resizeWithSharp(imageBuffer, detectedFormat);
  
  let resultBuffer = resized.buffer;
  let resultFormat = resized.format;
  let dimensions = resized.dimensions;
  
  // Token 预算检查
  const base64 = resultBuffer.toString('base64');
  const estimatedTokens = estimateImageTokens(base64.length);
  
  if (estimatedTokens > maxTokens) {
    // Aggressive 压缩
    const compressed = await compressAggressively(imageBuffer, maxTokens, detectedFormat);
    resultBuffer = compressed.buffer;
    resultFormat = compressed.format;
    
    // 更新 dimensions（压缩后尺寸可能变化）
    if (dimensions) {
      dimensions.displayWidth = undefined;
      dimensions.displayHeight = undefined;
    }
  }
  
  const finalBase64 = resultBuffer.toString('base64');
  const finalTokens = estimateImageTokens(finalBase64.length);
  
  if (finalTokens > maxTokens) {
    throw new MaxFileReadTokenExceededError(finalTokens, maxTokens);
  }
  
  // 标准化 mediaType
  const mediaType = `image/${resultFormat}` as ImageOutput['file']['mediaType'];
  
  return {
    type: 'image',
    file: {
      base64: finalBase64,
      mediaType,
      originalSize,
      dimensions,
    },
  };
}
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/image.ts
git commit -m "feat(read): add image.ts with sharp-based processing and token budget"
```

---

## Task 4: 创建 pdf.ts — PDF 处理

**Files:**
- Create: `src/agent/tools/read/pdf.ts`

- [ ] **Step 1: 创建 PDF 处理模块**

```typescript
import { mkdir, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PDFOutput, PartsOutput } from './types.js';
import {
  PDF_AT_MENTION_INLINE_THRESHOLD,
  PDF_MAX_EXTRACT_SIZE,
  PDF_MAX_PAGES_PER_READ,
  PDF_TARGET_RAW_SIZE,
} from './limits.js';

const execFileAsync = promisify(execFile);

export type PDFError = {
  reason: 'empty' | 'too_large' | 'password_protected' | 'corrupted' | 'unknown' | 'unavailable';
  message: string;
};

export type PDFResult<T> =
  | { success: true; data: T }
  | { success: false; error: PDFError };

/** 解析 PDF 页面范围 */
export function parsePDFPageRange(pages: string): { firstPage: number; lastPage: number } | null {
  // 格式: "1-5", "3", "10-20"
  const match = pages.match(/^(\d+)(?:-(\d+|\*))?$/);
  if (!match) return null;
  
  const firstPage = parseInt(match[1], 10);
  const lastPage = match[2] === '*' ? Infinity : parseInt(match[2] || match[1], 10);
  
  if (isNaN(firstPage) || firstPage < 1) return null;
  if (lastPage !== Infinity && (isNaN(lastPage) || lastPage < firstPage)) return null;
  
  return { firstPage, lastPage };
}

/** 验证 PDF header */
async function validatePDFHeader(filePath: string): Promise<boolean> {
  const fd = await readFile(filePath);
  const header = fd.subarray(0, 5).toString('ascii');
  return header.startsWith('%PDF-');
}

/** 获取 PDF 页数 */
export async function getPDFPageCount(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [filePath], { timeout: 10000 });
    const match = /^Pages:\s+(\d+)/m.exec(stdout);
    if (!match) return null;
    const count = parseInt(match[1], 10);
    return isNaN(count) ? null : count;
  } catch {
    return null;
  }
}

/** 检查 pdftoppm 是否可用 */
let pdftoppmAvailable: boolean | undefined;

export async function isPdftoppmAvailable(): Promise<boolean> {
  if (pdftoppmAvailable !== undefined) return pdftoppmAvailable;
  try {
    const result = await execFileAsync('pdftoppm', ['-v'], { timeout: 5000 });
    // pdftoppm 输出到 stderr
    pdftoppmAvailable = result.stderr.length > 0 || result.stdout.length > 0;
  } catch {
    pdftoppmAvailable = false;
  }
  return pdftoppmAvailable;
}

/** 提取 PDF 页面为图片 */
export async function extractPDFPages(
  filePath: string,
  options?: { firstPage?: number; lastPage?: number },
): Promise<PDFResult<PartsOutput['file']>> {
  try {
    const stats = await readFile(filePath).then(b => ({ size: b.length }));
    const originalSize = stats.size;
    
    if (originalSize === 0) {
      return { success: false, error: { reason: 'empty', message: `PDF file is empty: ${filePath}` } };
    }
    
    if (originalSize > PDF_MAX_EXTRACT_SIZE) {
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum extraction size of ${PDF_MAX_EXTRACT_SIZE} bytes.`,
        },
      };
    }
    
    const available = await isPdftoppmAvailable();
    if (!available) {
      return {
        success: false,
        error: {
          reason: 'unavailable',
          message: 'pdftoppm is not installed. Install poppler-utils (e.g. `brew install poppler` or `apt-get install poppler-utils`).',
        },
      };
    }
    
    const outputDir = join('/tmp', `pdf-${randomUUID()}`);
    await mkdir(outputDir, { recursive: true });
    
    const prefix = join(outputDir, 'page');
    const args = ['-jpeg', '-r', '150'];
    
    if (options?.firstPage) {
      args.push('-f', String(options.firstPage));
    }
    if (options?.lastPage && options.lastPage !== Infinity) {
      args.push('-l', String(options.lastPage));
    }
    args.push(filePath, prefix);
    
    const { stderr } = await execFileAsync('pdftoppm', args, { timeout: 120000 });
    
    if (stderr && /password/i.test(stderr)) {
      return {
        success: false,
        error: { reason: 'password_protected', message: 'PDF is password-protected.' },
      };
    }
    
    // 统计提取的页数
    const files = await readdir(outputDir);
    const pageCount = files.filter(f => f.endsWith('.jpg')).length;
    
    return {
      success: true,
      data: {
        filePath,
        originalSize,
        count: pageCount,
        outputDir,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: { reason: 'unknown', message: error.message || 'Unknown error during PDF extraction' },
    };
  }
}

/** 读取 PDF 文件 */
export async function readPDF(
  filePath: string,
  pages?: string,
): Promise<PDFOutput | PartsOutput> {
  // 验证 PDF header
  const isValid = await validatePDFHeader(filePath);
  if (!isValid) {
    throw new Error(`File is not a valid PDF (missing %PDF- header): ${filePath}`);
  }
  
  const fileBuffer = await readFile(filePath);
  const originalSize = fileBuffer.length;
  
  if (originalSize === 0) {
    throw new Error(`PDF file is empty: ${filePath}`);
  }
  
  if (originalSize > PDF_TARGET_RAW_SIZE) {
    throw new Error(
      `PDF file (${originalSize} bytes) exceeds maximum allowed size (${PDF_TARGET_RAW_SIZE} bytes).`,
    );
  }
  
  // 如果提供了 pages 参数，提取页面
  if (pages) {
    const parsedRange = parsePDFPageRange(pages);
    if (!parsedRange) {
      throw new Error(`Invalid pages format: "${pages}". Use "1-5", "3", or "10-20".`,);
    }
    
    const rangeSize = parsedRange.lastPage === Infinity
      ? PDF_MAX_PAGES_PER_READ + 1
      : parsedRange.lastPage - parsedRange.firstPage + 1;
    
    if (rangeSize > PDF_MAX_PAGES_PER_READ) {
      throw new Error(
        `Page range exceeds maximum of ${PDF_MAX_PAGES_PER_READ} pages per request.`,
      );
    }
    
    const extractResult = await extractPDFPages(filePath, parsedRange);
    if (!extractResult.success) {
      throw new Error(extractResult.error.message);
    }
    
    return {
      type: 'parts',
      file: extractResult.data,
    };
  }
  
  // 无 pages 参数：检查页数并返回 base64
  const pageCount = await getPDFPageCount(filePath);
  if (pageCount !== null && pageCount > PDF_AT_MENTION_INLINE_THRESHOLD) {
    throw new Error(
      `This PDF has ${pageCount} pages, which is too many to read at once. ` +
      `Use the pages parameter to read specific page ranges (e.g., pages: "1-5"). ` +
      `Maximum ${PDF_MAX_PAGES_PER_READ} pages per request.`,
    );
  }
  
  return {
    type: 'pdf',
    file: {
      filePath,
      base64: fileBuffer.toString('base64'),
      originalSize,
    },
  };
}
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/pdf.ts
git commit -m "feat(read): add pdf.ts with pdfinfo/pdftoppm integration"
```

---

## Task 5: 创建 notebook.ts — Notebook 解析

**Files:**
- Create: `src/agent/tools/read/notebook.ts`

- [ ] **Step 1: 创建 Notebook 解析模块**

```typescript
import { readFile } from 'fs/promises';
import type { NotebookOutput } from './types.js';
import { DEFAULT_LIMITS } from './limits.js';

/** Notebook cell 类型 */
export interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  outputs?: unknown[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
  id?: string;
}

/** Notebook 内容 */
export interface NotebookContent {
  cells: NotebookCell[];
  metadata: {
    language_info?: {
      name?: string;
    };
    kernelspec?: {
      language?: string;
    };
  };
  nbformat: number;
  nbformat_minor: number;
}

/**
 * 读取并解析 Jupyter Notebook
 */
export async function readNotebook(
  filePath: string,
  maxSizeBytes: number = DEFAULT_LIMITS.maxSizeBytes,
): Promise<NotebookOutput> {
  const content = await readFile(filePath, 'utf-8');
  
  let notebook: NotebookContent;
  try {
    notebook = JSON.parse(content) as NotebookContent;
  } catch {
    throw new Error(`Invalid JSON in notebook file: ${filePath}`);
  }
  
  // 验证基本结构
  if (!Array.isArray(notebook.cells)) {
    throw new Error(`Invalid notebook format (missing cells array): ${filePath}`);
  }
  
  // 序列化 cells 检查大小
  const cellsJson = JSON.stringify(notebook.cells);
  const cellsSize = Buffer.byteLength(cellsJson, 'utf8');
  
  if (cellsSize > maxSizeBytes) {
    throw new Error(
      `Notebook content (${cellsSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes). ` +
      `Use bash tool with jq to read specific cells.`,
    );
  }
  
  return {
    type: 'notebook',
    file: {
      filePath,
      cells: notebook.cells,
    },
  };
}
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/notebook.ts
git commit -m "feat(read): add notebook.ts for Jupyter notebook parsing"
```

---

## Task 6: 重写 read.ts — 核心调度器

**Files:**
- Modify: `src/agent/tools/read/read.ts`（完全重写）

- [ ] **Step 1: 重写 read.ts 为类型分发器**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { defineAgentTool } from '../../define-agent-tool.js';
import type { AgentTool } from '../../types.js';
import type { ReadOutput } from './types.js';
import { DEFAULT_LIMITS, roughTokenCount, MaxFileReadTokenExceededError } from './limits.js';
import { expandPath, validateReadInput } from './validation.js';
import { IMAGE_EXTENSIONS, readImage } from './image.js';
import { readPDF } from './pdf.js';
import { readNotebook } from './notebook.js';

const readSchema = Type.Object({
  path: Type.String({ description: '文件路径（相对或绝对路径）' }),
  offset: Type.Optional(Type.Number({ description: '起始行号（1-indexed）' })),
  limit: Type.Optional(Type.Number({ description: '最大读取行数' })),
  pages: Type.Optional(Type.String({ description: 'PDF 页面范围（如 "1-5"）' })),
});

type ReadInput = Static<typeof readSchema>;

const readOutputSchema = Type.Object({
  type: Type.String(),
  file: Type.Object({
    filePath: Type.String(),
    content: Type.Optional(Type.String()),
    numLines: Type.Optional(Type.Number()),
    startLine: Type.Optional(Type.Number()),
    totalLines: Type.Optional(Type.Number()),
    base64: Type.Optional(Type.String()),
    mediaType: Type.Optional(Type.String()),
    originalSize: Type.Optional(Type.Number()),
    dimensions: Type.Optional(Type.Object({
      originalWidth: Type.Number(),
      originalHeight: Type.Number(),
      displayWidth: Type.Optional(Type.Number()),
      displayHeight: Type.Optional(Type.Number()),
    })),
    cells: Type.Optional(Type.Array(Type.Any())),
    count: Type.Optional(Type.Number()),
    outputDir: Type.Optional(Type.String()),
  }),
});

/** 添加行号格式化 */
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

/** 读取文本文件 */
async function readText(
  filePath: string,
  offset: number,
  limit: number | undefined,
  maxTokens: number,
): Promise<Extract<ReadOutput, { type: 'text' }>> {
  const text = await readFile(filePath, 'utf-8');
  const allLines = text.split('\n');
  const totalLines = allLines.length;

  const lineOffset = offset === 0 ? 0 : offset - 1;
  const start = Math.max(0, lineOffset);
  const end = limit !== undefined ? start + limit : totalLines;
  const selectedLines = allLines.slice(start, end);
  const content = selectedLines.join('\n');

  // Token 预算检查
  const tokenEstimate = roughTokenCount(content);
  if (tokenEstimate > maxTokens) {
    throw new MaxFileReadTokenExceededError(tokenEstimate, maxTokens);
  }

  const contentWithLineNumbers = addLineNumbers(content, offset);

  return {
    type: 'text',
    file: {
      filePath,
      content: contentWithLineNumbers,
      numLines: selectedLines.length,
      startLine: offset,
      totalLines,
    },
  };
}

/** 按文件类型分发读取 */
async function readFileByType(
  filePath: string,
  ext: string,
  offset: number,
  limit: number | undefined,
  pages: string | undefined,
  maxSizeBytes: number,
  maxTokens: number,
): Promise<ReadOutput> {
  if (ext === 'ipynb') {
    return readNotebook(filePath, maxSizeBytes);
  }
  
  if (IMAGE_EXTENSIONS.has(ext)) {
    return readImage(filePath, maxTokens);
  }
  
  if (ext === 'pdf') {
    return readPDF(filePath, pages);
  }
  
  return readText(filePath, offset, limit, maxTokens);
}

export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    name: 'read',
    label: 'Read',
    description: 'Read the contents of a file (text, image, PDF, or notebook).',
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    validateInput: async (params: ReadInput) => {
      const result = await validateReadInput(params.path, cwd);
      
      // 额外校验 PDF pages 参数
      if (params.pages !== undefined) {
        const { parsePDFPageRange } = await import('./pdf.js');
        const parsed = parsePDFPageRange(params.pages);
        if (!parsed) {
          return {
            ok: false,
            message: `Invalid pages format: "${params.pages}". Use "1-5", "3", or "10-20".`,
            errorCode: 8,
          };
        }
      }
      
      return result;
    },

    execute: async (_toolCallId: string, params: ReadInput): Promise<ReadOutput> => {
      const fullPath = expandPath(params.path, cwd);
      const ext = extname(fullPath).toLowerCase().slice(1);
      const offset = params.offset ?? 1;

      return readFileByType(
        fullPath,
        ext,
        offset,
        params.limit,
        params.pages,
        DEFAULT_LIMITS.maxSizeBytes,
        DEFAULT_LIMITS.maxTokens,
      );
    },

    formatResult: (output: ReadOutput) => {
      switch (output.type) {
        case 'image':
          return [{
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: output.file.mediaType,
              data: output.file.base64,
            },
          }];
        case 'pdf':
          return [{
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf',
              data: output.file.base64,
            },
          }];
        case 'notebook':
          return [{
            type: 'text' as const,
            text: `Notebook: ${output.file.filePath}\nCells: ${output.file.cells.length}`,
          }];
        case 'parts':
          return [{
            type: 'text' as const,
            text: `PDF pages extracted: ${output.file.count} pages from ${output.file.filePath}`,
          }];
        case 'file_unchanged':
          return [{
            type: 'text' as const,
            text: `File unchanged since last read: ${output.file.filePath}`,
          }];
        case 'text':
        default:
          return [{ type: 'text' as const, text: output.file.content || '' }];
      }
    },
  });
}
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/read.ts
git commit -m "feat(read): rewrite read.ts as file-type dispatcher"
```

---

## Task 7: 更新 validation.ts — 扩展校验

**Files:**
- Modify: `src/agent/tools/read/validation.ts`

- [ ] **Step 1: 扩展校验逻辑**

在 validation.ts 末尾添加 PDF 校验相关的导出：

```typescript
// 在文件末尾添加

/**
 * 校验 PDF 特定参数
 */
export async function validatePDFInput(
  filePath: string,
  pages?: string,
): Promise<{ ok: true } | ValidationError> {
  if (pages !== undefined) {
    // 动态导入避免循环依赖
    const { parsePDFPageRange } = await import('./pdf.js');
    const parsed = parsePDFPageRange(pages);
    if (!parsed) {
      return {
        ok: false,
        message: `Invalid pages parameter: "${pages}". Use formats like "1-5", "3", or "10-20". Pages are 1-indexed.`,
        errorCode: 8,
      };
    }
    
    const rangeSize = parsed.lastPage === Infinity
      ? 21  // PDF_MAX_PAGES_PER_READ + 1
      : parsed.lastPage - parsed.firstPage + 1;
    
    if (rangeSize > 20) {  // PDF_MAX_PAGES_PER_READ
      return {
        ok: false,
        message: `Page range "${pages}" exceeds maximum of 20 pages per request. Please use a smaller range.`,
        errorCode: 8,
      };
    }
  }
  
  return { ok: true };
}
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/validation.ts
git commit -m "feat(read): add PDF-specific validation for pages parameter"
```

---

## Task 8: 更新 index.ts — 导出新增模块

**Files:**
- Modify: `src/agent/tools/read/index.ts`

- [ ] **Step 1: 更新导出**

```typescript
export { createReadTool } from './read.js';
export type { ReadInput, ReadOutput } from './types.js';
export { DEFAULT_LIMITS, MaxFileReadTokenExceededError } from './limits.js';
export { expandPath, validateReadInput } from './validation.js';
export { readImage, IMAGE_EXTENSIONS } from './image.js';
export { readPDF, parsePDFPageRange, extractPDFPages } from './pdf.js';
export { readNotebook } from './notebook.js';
```

- [ ] **Step 2: 验证**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/read/index.ts
git commit -m "feat(read): update exports for phase 2 modules"
```

---

## Task 9: 验证完整实现

**验证点：**

- [ ] 1. 运行完整类型检查

```bash
bun run typecheck
```

Expected: PASS

- [ ] 2. 运行测试

```bash
bun test
```

Expected: 所有现有测试通过

- [ ] 3. 验收标准检查

| 标准 | 状态 |
|------|------|
| 支持 PNG/JPG/GIF/WebP 图片读取 | 待验证 |
| 图片超出 token 预算时自动压缩 | 待验证 |
| 支持 PDF 读取（base64） | 待验证 |
| 支持 PDF 分页提取（pages 参数） | 待验证 |
| 支持 Jupyter Notebook 读取 | 待验证 |
| 文本内容 token 预算控制 | 待验证 |
| 所有文件类型统一 discriminatedUnion 输出 | 待验证 |

---

## Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| discriminatedUnion 输出类型 | Task 1 |
| API 限制常量 | Task 2 |
| 图片处理（sharp） | Task 3 |
| PDF 处理（pdfinfo/pdftoppm） | Task 4 |
| Notebook 解析 | Task 5 |
| 文件类型分发 | Task 6 |
| Token 预算控制 | Task 2, 3, 6 |
| PDF pages 校验 | Task 7 |

---

## 自检清单

- [ ] 无 TBD/TODO
- [ ] 所有代码步骤包含完整代码
- [ ] 类型一致性检查通过
- [ ] 文件路径准确
