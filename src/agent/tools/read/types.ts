// 输入参数
export interface ReadInput {
  path: string;           // 文件路径（相对或绝对）
  offset?: number;        // 起始行号（1-indexed）
  limit?: number;         // 最大读取行数
  pages?: string;         // PDF 页面范围（如 "1-5"）
}

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

// 校验结果
export interface ValidationResult {
  ok: true;
}

export interface ValidationError {
  ok: false;
  message: string;
  errorCode?: number;
}
