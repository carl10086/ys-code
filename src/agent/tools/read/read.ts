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

    formatResult: (output: ReadOutput, _toolCallId: string) => {
      switch (output.type) {
        case 'image':
          return [{
            type: 'image',
            data: output.file.base64,
            mimeType: output.file.mediaType,
          }];
        case 'pdf':
          return [{
            type: 'text',
            text: `PDF: ${output.file.filePath} (${output.file.originalSize} bytes, base64 encoded)`,
          }];
        case 'notebook':
          return [{
            type: 'text',
            text: `Notebook: ${output.file.filePath}\nCells: ${output.file.cells.length}`,
          }];
        case 'parts':
          return [{
            type: 'text',
            text: `PDF pages extracted: ${output.file.count} pages from ${output.file.filePath}`,
          }];
        case 'file_unchanged':
          return [{
            type: 'text',
            text: `File unchanged since last read: ${output.file.filePath}`,
          }];
        case 'text':
        default:
          return [{ type: 'text', text: output.file.content || '' }];
      }
    },
  });
}
