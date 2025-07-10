const axios = require('axios');
const { createClient } = require('redis');
const logger = require('./logger');

let redisClient;

/**
 * 初始化并返回一个共享的 Redis 客户端实例。
 * @param {object} redisOptions - Redis 连接选项
 * @returns {import('redis').RedisClientType}
 */
const getRedisClient = (redisOptions) => {
  if (!redisClient) {
    redisClient = createClient({
      socket: {
        host: redisOptions.host,
        port: redisOptions.port,
      },
      password: redisOptions.password,
      database: redisOptions.db || 0,
    });
    redisClient.connect().catch(err => logger.error('Worker Redis client connection error:', err));
  }
  return redisClient;
};

/**
 * 处理一个单独的子请求任务。
 *
 * @param {import('bullmq').Job} job - BullMQ 的子作业对象。
 * @param {object} context - 包含 agentId 和 redisOptions 的上下文。
 * @returns {Promise<object|undefined>} - 如果是 Promise 模式, 返回结果对象; 如果是 Stream 模式, 则不返回。
 */
const processJob = async (job, { agentId, redisOptions }) => {
  const { axiosConfig, reportBy, channelName } = job.data;
  const subRequestId = axiosConfig.meta?.subRequestId;
  const taskId = job.parent?.id;

  const logChild = logger.child({ jobId: taskId, subRequestId, agentId });
  let resultObject;

  try {
    const response = await axios(axiosConfig);
    resultObject = {
      success: true,
      input: axiosConfig,
      status: response.status,
      data: response.data,
    };
    logChild.info('子任务成功。');
  } catch (error) {
    resultObject = {
      success: false,
      input: axiosConfig,
      error: {
        message: error.message,
        status: error.response?.status,
        code: error.code,
      },
    };
    logChild.warn({ errorCode: error.code, status: error.response?.status }, '子任务失败。');
  } finally {
    if (reportBy === 'pubsub' && channelName) {
      const pubsubClient = getRedisClient(redisOptions);
      try {
        await pubsubClient.publish(channelName, JSON.stringify(resultObject));
        logChild.info({ channel: channelName }, '结果已通过 Pub/Sub 发布。');
      } catch (e) {
        logChild.error({ err: e, channel: channelName }, '通过 Pub/Sub 发布结果失败。');
      }
    }
  }

  // 对于 pubsub 模式, 我们不希望 bullmq 存储返回值, 节省 redis 内存
  if (reportBy === 'pubsub') {
    return undefined;
  }

  // Promise 模式: 向上返回结果给父作业
  // 注意: 如果子作业失败了, 但我们仍然返回一个对象而不是抛出错误,
  // 那么从 BullMQ 的角度看这个作业是 "成功完成" 的。
  // 这允许父作业收集到所有的结果, 包括那些失败的结果。
  return resultObject;
};

/**
 * 优雅地关闭共享的 Redis 客户端连接。
 */
const closeRedisClient = async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
};

module.exports = { processJob, closeRedisClient, getRedisClient };
