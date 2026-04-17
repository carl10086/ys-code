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
    const stats = await readFile(filePath).then((b) => ({ size: b.length }));
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
    const pageCount = files.filter((f) => f.endsWith('.jpg')).length;

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

    const rangeSize =
      parsedRange.lastPage === Infinity
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
