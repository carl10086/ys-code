import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { stat } from 'fs/promises';
import type { ValidationError } from './types.js';
import { DEFAULT_LIMITS } from './limits.js';

/** 二进制文件扩展名集合 */
const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'bmp', 'tiff', 'tif',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'tgz', 'iso',
  'mp3', 'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v', 'mpeg', 'mpg',
  'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'pyc', 'pyo', 'class', 'jar', 'war', 'ear', 'node', 'wasm', 'rlib',
  'sqlite', 'sqlite3', 'db', 'mdb', 'idx',
  'psd', 'ai', 'eps', 'sketch', 'fig', 'xd', 'blend', '3ds', 'max',
  'swf', 'fla', 'lockb', 'data',
]);

/** 设备文件路径集合 */
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
  '/dev/stdin', '/dev/tty', '/dev/console',
  '/dev/stdout', '/dev/stderr',
  '/dev/fd/0', '/dev/fd/1', '/dev/fd/2',
]);

export function expandPath(inputPath: string, cwd?: string): string {
  const baseDir = cwd ?? process.cwd();
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/')) return join(homedir(), inputPath.slice(2));
  if (isAbsolute(inputPath)) return inputPath;
  return resolve(baseDir, inputPath);
}

export function hasBinaryExtension(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf('.');
  const ext = dotIndex === -1 ? '' : filePath.slice(dotIndex).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
  if (filePath.startsWith('/proc/')) {
    const procFdMatch = /^\/proc\/[^\/]+\/fd\/[012]$/.test(filePath);
    if (procFdMatch) return true;
  }
  return false;
}

export async function validateReadInput(
  path: string,
  cwd?: string,
): Promise<{ ok: true } | ValidationError> {
  const fullPath = expandPath(path, cwd);
  if (isBlockedDevicePath(fullPath)) {
    return { ok: false, message: `Cannot read '${path}': this device file would block or produce infinite output.`, errorCode: 9 };
  }
  if (hasBinaryExtension(fullPath)) {
    return { ok: false, message: `Cannot read binary file '${path}'. Use appropriate tools for binary file analysis.`, errorCode: 4 };
  }
  try {
    const stats = await stat(fullPath);
    if (stats.size > DEFAULT_LIMITS.maxSizeBytes) {
      return { ok: false, message: `File content (${stats.size} bytes) exceeds maximum allowed size (${DEFAULT_LIMITS.maxSizeBytes} bytes). Use offset and limit parameters to read specific portions.`, errorCode: 6 };
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { ok: false, message: `File does not exist: ${fullPath}`, errorCode: 1 };
    }
    return { ok: false, message: `Cannot read '${path}': ${error.message ?? 'Unknown error'}`, errorCode: 1 };
  }
  return { ok: true };
}
