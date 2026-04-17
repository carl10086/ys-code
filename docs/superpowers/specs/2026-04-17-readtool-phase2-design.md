# ReadTool Phase 2 增强设计文档

## 概述

在 Phase 1（文本读取 + 行号 + 基础校验）基础上，继续实现图片、PDF、Notebook 支持，并对齐 claude-code (cc) 的核心机制。

## 现状

### Phase 1 已完成
- 文本分页读取（offset/limit）
- cat -n 行号格式
- 路径规范化（expandPath）
- 二进制/设备文件拒绝
- 文件大小限制（256KB）

### 与 cc 的差距
| 功能 | 当前状态 | cc 实现 |
|------|---------|---------|
| 图片支持 | ❌ | ✅ sharp 多级压缩 |
| PDF 支持 | ❌ | ✅ pdfinfo/pdftoppm |
| Notebook 支持 | ❌ | ✅ 原生 JSON 解析 |
| Token 预算 | ❌ | ✅ maxTokens 限制 |
| Dedupe 去重 | ❌ | ✅ 基于 mtime |
| 输出 schema | 单一 text | ✅ discriminatedUnion |

## 架构

### 目录结构

```
src/agent/tools/read/
├── index.ts           # 导出
├── read.ts            # 核心调度（按文件类型分发）
├── types.ts           # 扩展输出类型（discriminatedUnion）
├── limits.ts          # 限制配置（新增 token 预算）
├── validation.ts      # 输入校验
├── image.ts           # 图片处理（sharp 动态导入）
├── pdf.ts             # PDF 处理（系统命令）
└── notebook.ts        # Notebook 解析
```

### 输出类型（ discriminatedUnion ）

```typescript
export type ReadOutput =
  | { type: 'text'; file: { filePath: string; content: string; numLines: number; startLine: number; totalLines: number } }
  | { type: 'image'; file: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; originalSize: number; dimensions?: { originalWidth: number; originalHeight: number; displayWidth?: number; displayHeight?: number } } }
  | { type: 'pdf'; file: { filePath: string; base64: string; originalSize: number } }
  | { type: 'notebook'; file: { filePath: string; cells: unknown[] } }
  | { type: 'parts'; file: { filePath: string; originalSize: number; count: number; outputDir: string } }
  | { type: 'file_unchanged'; file: { filePath: string } };
```

## 核心实现

### 1. 文件类型分发（read.ts）

```typescript
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export async function readFileByType(
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
    return readPDF(filePath, pages, maxSizeBytes, maxTokens);
  }
  return readText(filePath, offset, limit, maxSizeBytes, maxTokens);
}
```

### 2. 图片处理（image.ts）

**依赖：** `sharp`（动态导入，失败时降级）

**流程：**
1. 读取文件到 Buffer
2. 检测图片格式（通过 magic bytes）
3. 标准 resize（最大尺寸限制）
4. Token 预算检查（`base64.length * 0.125`）
5. 如超限，aggressive 压缩（质量降低）
6. 如仍超限，sharp fallback（400x400, quality=20）

```typescript
export async function readImage(
  filePath: string,
  maxTokens: number = DEFAULT_LIMITS.maxTokens,
): Promise<Extract<ReadOutput, { type: 'image' }>> {
  const imageBuffer = await readFile(filePath);
  const originalSize = imageBuffer.length;
  const detectedFormat = detectImageFormat(imageBuffer);

  // 标准 resize
  let result = await resizeImage(imageBuffer, detectedFormat);

  // Token 预算检查
  const estimatedTokens = Math.ceil(result.base64.length * 0.125);
  if (estimatedTokens > maxTokens) {
    // Aggressive 压缩
    result = await compressImage(imageBuffer, maxTokens, detectedFormat);
  }

  return {
    type: 'image',
    file: {
      base64: result.base64,
      mediaType: result.mediaType,
      originalSize,
      dimensions: result.dimensions,
    },
  };
}
```

### 3. PDF 处理（pdf.ts）

**依赖：** `poppler-utils` 系统包（`pdfinfo` + `pdftoppm`）

**流程：**
1. 验证 `%PDF-` header
2. 检查文件大小
3. 如提供 `pages` 参数：
   - 解析页面范围
   - 调用 `pdftoppm` 提取为 JPEG
   - 返回 `parts` 类型
4. 如无 `pages` 参数：
   - 获取页数（`pdfinfo`）
   - 页数过多时提示使用 `pages`
   - 读取为 base64，返回 `pdf` 类型

```typescript
export async function readPDF(
  filePath: string,
  pages: string | undefined,
  maxSizeBytes: number,
  maxTokens: number,
): Promise<Extract<ReadOutput, { type: 'pdf' | 'parts' }>> {
  // 验证 header
  const header = await readFileHeader(filePath, 5);
  if (!header.startsWith('%PDF-')) {
    throw new Error('File is not a valid PDF');
  }

  if (pages) {
    const parsedRange = parsePDFPageRange(pages);
    const extractResult = await extractPDFPages(filePath, parsedRange);
    return { type: 'parts', file: extractResult };
  }

  const pageCount = await getPDFPageCount(filePath);
  if (pageCount && pageCount > PDF_AT_MENTION_INLINE_THRESHOLD) {
    throw new Error(`PDF has ${pageCount} pages. Use pages parameter.`);
  }

  const fileBuffer = await readFile(filePath);
  return {
    type: 'pdf',
    file: {
      filePath,
      base64: fileBuffer.toString('base64'),
      originalSize: fileBuffer.length,
    },
  };
}
```

### 4. Notebook 解析（notebook.ts）

**依赖：** 无（原生 JSON 解析）

**流程：**
1. 读取 `.ipynb` 文件
2. JSON 解析
3. 提取 cells 数组
4. 验证内容大小

```typescript
export async function readNotebook(
  filePath: string,
  maxSizeBytes: number,
): Promise<Extract<ReadOutput, { type: 'notebook' }>> {
  const content = await readFile(filePath, 'utf-8');
  const notebook = JSON.parse(content);

  const cellsJson = JSON.stringify(notebook.cells);
  if (Buffer.byteLength(cellsJson) > maxSizeBytes) {
    throw new Error('Notebook content exceeds maximum size');
  }

  return {
    type: 'notebook',
    file: { filePath, cells: notebook.cells },
  };
}
```

### 5. Token 预算（limits.ts）

```typescript
export interface FileReadingLimits {
  maxTokens: number;      // 默认 25000
  maxSizeBytes: number;   // 默认 256KB
}

export async function validateContentTokens(
  content: string,
  ext: string,
  maxTokens?: number,
): Promise<void> {
  const effectiveMaxTokens = maxTokens ?? DEFAULT_LIMITS.maxTokens;
  const tokenEstimate = roughTokenCount(content, ext);

  if (tokenEstimate > effectiveMaxTokens / 4) {
    const tokenCount = await countTokensWithAPI(content);
    if (tokenCount > effectiveMaxTokens) {
      throw new MaxFileReadTokenExceededError(tokenCount, effectiveMaxTokens);
    }
  }
}
```

### 6. Dedupe 去重（read.ts）

```typescript
const readFileState = new Map<string, {
  content: string;
  timestamp: number;
  offset?: number;
  limit?: number;
}>();

// 执行前检查
const existing = readFileState.get(filePath);
if (existing && existing.offset === offset && existing.limit === limit) {
  const mtimeMs = await getFileModificationTime(filePath);
  if (mtimeMs === existing.timestamp) {
    return { type: 'file_unchanged', file: { filePath } };
  }
}
```

## 依赖

### npm 依赖
- `sharp`（图片处理，可选依赖）

### 系统依赖
- `poppler-utils`（PDF 处理：pdfinfo + pdftoppm）

### 安装命令
```bash
# macOS
brew install poppler

# Ubuntu/Debian
apt-get install poppler-utils
```

## 错误码

| errorCode | 含义 |
|-----------|------|
| 1 | 文件不存在 |
| 4 | 二进制文件 |
| 6 | 文件过大 |
| 7 | PDF 页数过多 |
| 8 | PDF 页面范围超出限制 |
| 9 | 设备文件 |

## 验收标准

1. ✅ 支持 PNG/JPG/GIF/WebP 图片读取
2. ✅ 图片超出 token 预算时自动压缩
3. ✅ 支持 PDF 读取（base64）
4. ✅ 支持 PDF 分页提取（pages 参数）
5. ✅ 支持 Jupyter Notebook 读取
6. ✅ 文本内容 token 预算控制
7. ✅ 文件未变更时返回 dedup 标记
8. ✅ 所有文件类型统一 discriminatedUnion 输出
