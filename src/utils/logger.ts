import fs from 'fs';

/**
 * 日志文件路径
 */
const LOG_FILE = './ys-code.log';

/**
 * 日志级别优先级
 */
const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 当前日志级别，由环境变量 YS_LOG_LEVEL 控制，默认 info
 */
const currentLevel = LEVELS[process.env.YS_LOG_LEVEL || 'info'] ?? LEVELS.info;

/**
 * 写入日志到文件
 * 使用同步写入，确保进程退出前日志不丢失
 */
function write(level: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level.toLowerCase()] < currentLevel) {
    return;
  }

  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  const line = `[${timestamp}] [${level}] ${message}${metaStr}\n`;

  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // 静默失败，不影响 TUI 和业务代码
  }
}

/**
 * 日志实例
 * 提供 debug/info/warn/error 四级日志
 */
export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('DEBUG', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('INFO', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('WARN', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('ERROR', msg, meta),
};
