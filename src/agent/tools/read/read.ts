import { Type, type Static } from '@sinclair/typebox';
import { readFile, stat } from 'fs/promises';
import { extname } from 'path';
import { defineAgentTool } from '../../define-agent-tool.js';
import type { AgentTool, ToolUseContext } from '../../types.js';
import type { ReadOutput } from './types.js';
import { DEFAULT_LIMITS, roughTokenCount, MaxFileReadTokenExceededError } from './limits.js';
import { expandPath, validateReadInput } from './validation.js';
import { IMAGE_EXTENSIONS, readImage } from './image.js';
import { readPDF } from './pdf.js';
import { readNotebook } from './notebook.js';

const readSchema = Type.Object({
  file_path: Type.String({ description: 'The absolute path to the file to read' }),
  offset: Type.Optional(Type.Number({ description: 'The line number to start reading from. Only provide if the file is too large to read at once' })),
  limit: Type.Optional(Type.Number({ description: 'The number of lines to read. Only provide if the file is too large to read at once.' })),
  pages: Type.Optional(Type.String({ description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.' })),
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
    name: 'Read',
    label: 'Read',
    description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    prepareArguments: (args: unknown) => {
      const parsed = args as Record<string, unknown>;
      if (typeof parsed.offset === 'string' && /^\d+$/.test(parsed.offset)) {
        parsed.offset = Number(parsed.offset);
      }
      if (typeof parsed.limit === 'string' && /^\d+$/.test(parsed.limit)) {
        parsed.limit = Number(parsed.limit);
      }
      return parsed as ReadInput;
    },

    validateInput: async (params: ReadInput) => {
      const result = await validateReadInput(params.file_path, cwd);

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

    execute: async (_toolCallId: string, params: ReadInput, context: ToolUseContext): Promise<ReadOutput> => {
      const fullPath = expandPath(params.file_path, cwd);
      const ext = extname(fullPath).toLowerCase().slice(1);
      const offset = params.offset ?? 1;

      const result = await readFileByType(
        fullPath,
        ext,
        offset,
        params.limit,
        params.pages,
        DEFAULT_LIMITS.maxSizeBytes,
        DEFAULT_LIMITS.maxTokens,
      );

      // Record read state in FileStateCache for read-before-write validation
      const stats = await stat(fullPath);
      const content = 'content' in result.file ? result.file.content ?? '' : '';
      context.fileStateCache.recordRead(
        fullPath,
        content,
        Math.floor(stats.mtimeMs),
        params.offset,
        params.limit,
      );

      return result;
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
