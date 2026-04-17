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
