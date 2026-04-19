import pino from 'pino';

/**
 * 创建 pino transport，在 worker thread 中运行
 * 避免阻塞主线程，不影响 TUI 渲染
 */
const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: './ys-code.log',  // 日志文件路径
    append: true,                   // 追加模式
    colorize: false,                // 文件不需要颜色
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',  // 时间格式
    ignore: 'pid,hostname',         // 简化输出字段
  }
});

/**
 * 单例 logger 实例
 * 级别由 YS_LOG_LEVEL 环境变量控制，默认 info
 */
export const logger = pino({
  level: process.env.YS_LOG_LEVEL || 'info',
}, transport);

/**
 * 进程退出时优雅关闭 transport
 * 确保缓冲中的日志落盘
 */
process.on('beforeExit', () => {
  transport.end?.();
});
