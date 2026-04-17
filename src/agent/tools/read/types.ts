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
