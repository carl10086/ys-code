import fs from 'fs';
import { resolve } from 'path';
import pino from 'pino';
import PinoPretty from 'pino-pretty';

/**
 * 日志文件路径
 * 支持 YS_LOG_FILE 环境变量覆盖，默认写到当前工作目录（启动时解析为绝对路径）
 */
const LOG_FILE = process.env.YS_LOG_FILE
  ? resolve(process.env.YS_LOG_FILE)
  : resolve(process.cwd(), 'ys-code.log');

/**
 * 当前日志级别，由环境变量 YS_LOG_LEVEL 控制，默认 info
 */
const currentLevel = process.env.YS_LOG_LEVEL || 'info';

/**
 * 解析调用位置，返回 "相对路径:行号" 格式
 * 跳过 logger.ts 本身和 node_modules 中的帧
 */
function getCaller(): string | undefined {
  const err = new Error();
  const stack = err.stack?.split('\n') ?? [];

  for (let i = 3; i < stack.length; i++) {
    const line = stack[i];
    if (!line || line.includes('node_modules') || line.includes('/logger.ts')) {
      continue;
    }

    // 匹配以下格式：
    //   at functionName (file:///abs/path/to/file.ts:42:10)
    //   at /abs/path/to/file.ts:42:10
    const match = line.match(/\s+at\s+(?:.*?\s+)?(?:\()?file:\/\/(.+):(\d+):(\d+)(?:\))?/)
      || line.match(/\s+at\s+(?:.*?\s+)?\((.+):(\d+):(\d+)\)/)
      || line.match(/\s+at\s+(.+):(\d+):(\d+)/);

    if (match) {
      const [, file, lineNo] = match;
      // 简化为相对于项目根目录的路径
      const cwd = process.cwd();
      const rel = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
      return `${rel}:${lineNo}`;
    }
  }

  return undefined;
}

/**
 * pino-pretty 格式化器，在主线程中同步格式化
 */
const pretty = PinoPretty.prettyFactory({
  colorize: false,
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  ignore: 'pid,hostname,caller',
  messageFormat: (log: Record<string, unknown>, messageKey: string) => {
    const msg = log[messageKey] as string;
    const caller = log.caller as string | undefined;
    return caller ? `(${caller}): ${msg}` : msg;
  },
});

/**
 * 自定义 destination：JSON 日志经 pretty 格式化后同步追加到文件
 * 避免使用 pino transport（Bun 的 worker_threads 不兼容）
 */
const destination = {
  write(chunk: string) {
    try {
      const log = JSON.parse(chunk);
      const line = pretty(log);
      fs.appendFileSync(LOG_FILE, line);
    } catch {
      // 静默失败，不影响 TUI 和业务代码
    }
  },
};

/**
 * 底层 pino 实例
 */
const pinoLogger = pino(
  {
    level: currentLevel,
    // mixin 在每条日志中注入 caller，保持包装层接口简洁
    mixin() {
      return { caller: getCaller() };
    },
  },
  destination as unknown as NodeJS.WritableStream
);

/**
 * 日志实例
 * 提供 debug/info/warn/error 四级日志，保持与旧接口一致
 */
export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    pinoLogger.debug(meta || {}, msg);
  },
  info: (msg: string, meta?: Record<string, unknown>) => {
    pinoLogger.info(meta || {}, msg);
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    pinoLogger.warn(meta || {}, msg);
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    pinoLogger.error(meta || {}, msg);
  },
};
