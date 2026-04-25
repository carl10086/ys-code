import { readFile, writeFile } from "fs/promises";

/**
 * 文件编码信息
 */
export interface FileEncoding {
  /** 文件编码格式 */
  encoding: "utf8" | "utf16le";
  /** 原始行尾符 */
  lineEndings: "\n" | "\r\n";
}

/**
 * 编码感知读取结果
 */
export interface ReadResult {
  /** 文件内容（内部统一为 \n） */
  content: string;
  /** 原始编码信息 */
  encoding: FileEncoding;
}

/**
 * 检测文件编码（通过 BOM）
 * @param buffer 文件原始 Buffer
 * @returns 编码格式
 */
function detectEncoding(buffer: Buffer): "utf8" | "utf16le" {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }
  return "utf8";
}

/**
 * 检测行尾符
 * @param content 原始文件内容
 * @returns 行尾符类型
 */
function detectLineEndings(content: string): "\n" | "\r\n" {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/\n/g) || []).length - crlfCount;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

/**
 * 读取文件，自动检测编码和行尾，内部统一为 \n
 * @param path 文件路径
 * @returns 读取结果
 */
export async function readFileWithEncoding(path: string): Promise<ReadResult> {
  const buffer = await readFile(path);
  const encoding = detectEncoding(buffer);
  let content = buffer.toString(encoding);
  // Strip BOM if present (UTF-16 LE BOM is 0xFEFF which becomes U+FEFF in string)
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }
  const lineEndings = detectLineEndings(content);
  content = content.replaceAll("\r\n", "\n");
  return { content, encoding: { encoding, lineEndings } };
}

/**
 * 写入文件，保持原始编码和行尾
 * @param path 文件路径
 * @param content 内容（内部使用 \n）
 * @param encoding 原始编码信息
 */
export async function writeFileWithEncoding(
  path: string,
  content: string,
  encoding: FileEncoding,
): Promise<void> {
  let finalContent = content;
  if (encoding.lineEndings === "\r\n") {
    finalContent = content.replaceAll("\n", "\r\n");
  }
  let buffer = Buffer.from(finalContent, encoding.encoding);
  // Add BOM for UTF-16 LE
  if (encoding.encoding === "utf16le") {
    const bom = Buffer.from([0xff, 0xfe]);
    buffer = Buffer.concat([bom, buffer]);
  }
  await writeFile(path, buffer);
}
