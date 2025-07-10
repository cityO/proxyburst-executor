const pino = require('pino');

// 默认配置
const pinoConfig = {
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// 在非生产环境中，使用 pino-pretty 美化输出
if (process.env.NODE_ENV !== 'production') {
  pinoConfig.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true, // 开启颜色
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', // 时间格式化
      ignore: 'pid,hostname,agentId', // 忽略不必要的字段，让日志更简洁
      messageFormat: '[{jobId}] {msg}', // 自定义消息格式
    },
  };
}

/**
 * 创建一个结构化日志记录器。
 * 在开发环境中，日志会被 pino-pretty 美化。
 * 在生产环境中，输出标准的 JSON 日志。
 * @example
 * logger.info({ userId: 123 }, "用户已登录");
 * logger.error({ err, requestId }, "发生了一个错误");
 */
const logger = pino(pinoConfig);

module.exports = logger;
