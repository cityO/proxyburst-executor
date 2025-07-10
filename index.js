require('dotenv').config();
const os = require('os');
const http = require('http');
const { Worker } = require('bullmq');
const { processJob, getRedisClient, closeRedisClient } = require('./worker');
const logger = require('./logger');

// --- 1. 身份标识与配置加载 ---
const agentName = process.env.AGENT_NAME || 'default-executor';
const agentId = `${agentName}-${os.hostname()}-${process.pid}`;

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
};

const queueName = process.env.QUEUE_NAME || 'proxyburst-v2-jobs';
const concurrency = parseInt(process.env.AGENT_CONCURRENCY || '50', 10);
const healthCheckPortPreference = parseInt(process.env.HEALTH_CHECK_PORT || '3000', 10);

const mainLogger = logger.child({ agentId });

mainLogger.info({
  type: 'startup',
  config: {
    queueName,
    concurrency,
    healthCheckPort: healthCheckPortPreference,
    redisHost: redisConnection.host,
  }
}, 'ProxyBurst 执行器正在启动...');

// --- 2. BullMQ Worker 初始化 ---

/**
 * 作业处理器/分发器。
 *
 * 根据作业的数据结构判断是父任务还是子任务, 并进行相应的处理。
 * - 子任务 (包含 axiosConfig): 交给 processJob 函数执行 HTTP 请求。
 * - 父任务 (不含 axiosConfig): 直接标记为完成, 因为它的作用是容器, 其状态由 BullMQ Flow 自动管理。
 *
 * @param {import('bullmq').Job} job - 从队列中获取的 BullMQ 作业。
 * @returns {Promise<any>}
 */
const jobProcessor = (job) => {
  // 检查这是否是一个可执行的子任务
  if (job.data && job.data.axiosConfig) {
    return processJob(job, { agentId, redisOptions: redisConnection });
  }

  // 否则, 假定它是一个父任务, 它的唯一作用是聚合子任务。
  // 我们不需要在这里做任何事情, BullMQ Flow 会处理它的完成状态。
  mainLogger.info({ type: 'parent_job_acknowledged', bullJobId: job.id, jobId: job.data?.taskId, taskName: job.name }, `父任务 "${job.name}" 已确认, 等待子任务完成...`);
  return Promise.resolve();
};

const worker = new Worker(
  queueName,
  jobProcessor,
  {
    connection: redisConnection,
    concurrency: concurrency,
    removeOnComplete: { count: 1000 }, // 保留最近1000个已完成的任务
    removeOnFail: { count: 5000 },    // 保留最近5000个已失败的任务
  }
);

worker.on('completed', async (job, result) => {
  mainLogger.info({ type: 'job_completed', bullJobId: job.id, jobId: job.data.jobId }, `任务处理完成。`);

  // 当一个流式 *父任务* 完成时 (标志是没有 axiosConfig), 我们需要向客户端发送流结束信号。
  // 如果不检查 !job.data.axiosConfig, 那么第一个完成的 *子任务* 就会错误地触发 STREAM_END。
  if (job.data && job.data.channelName && !job.data.axiosConfig) {
    try {
      const redisClient = getRedisClient(redisConnection);
      await redisClient.publish(job.data.channelName, 'STREAM_END');
      mainLogger.info({ type: 'stream_end_published', channel: job.data.channelName }, '已发布流结束信号。');
    } catch (e) {
      mainLogger.error({ type: 'stream_end_publish_failed', channel: job.data.channelName, error: e.message }, '发布流结束信号失败。');
    }
  }
});

worker.on('failed', (job, err) => {
  mainLogger.error({ type: 'job_failed', bullJobId: job.id, jobId: job.data.jobId, error: err.message, stack: err.stack }, `任务处理失败。`);
});

// --- 3. 健康检查服务器 ---
async function startHealthCheckServer() {
  // get-port 是 ESM 包, 需要动态 import
  const { default: getPort } = await import('get-port');

  const actualPort = await getPort({ port: healthCheckPortPreference });

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      try {
        const isHealthy = await worker.isReady();
        if (isHealthy) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', agentId, port: actualPort, timestamp: new Date().toISOString() }));
        } else {
          throw new Error('Worker 尚未就绪。');
        }
      } catch (error) {
        mainLogger.warn({ type: 'health_check_failed', error: error.message }, '健康检查失败。');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy', agentId, reason: error.message }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('未找到');
    }
  });

  server.on('error', (err) => {
    mainLogger.error({ type: 'health_server_error', error: err.message, stack: err.stack }, '健康检查服务器发生严重错误。');
    process.exit(1); // 在服务器无法启动时退出
  });

  server.listen(actualPort, () => {
    mainLogger.info({ type: 'health_server_started', port: actualPort }, `健康检查服务器正在运行于端口 ${actualPort}。`);
  });

  return server; // 返回 server 实例以便优雅停机
}

// 启动服务器并将其用于优雅停机
let healthServer;
startHealthCheckServer()
  .then(server => {
    healthServer = server;
  })
  .catch(err => {
    mainLogger.error({ type: 'startup_error', error: err.message, stack: err.stack }, '启动健康检查服务器失败。');
    process.exit(1);
  });


// --- 4. 优雅停机机制 ---
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach(signal => {
  process.on(signal, async () => {
    mainLogger.info({ type: 'shutdown_received', signal }, `接收到 ${signal} 信号, 正在优雅地关闭...`);

    // 停止健康检查服务器接收新的连接
    if (healthServer) {
      healthServer.close();
    }

    // 关闭 worker，它会等待当前正在执行的任务完成
    await worker.close();

    // 关闭共享的 Redis Pub/Sub 客户端
    await closeRedisClient();

    mainLogger.info({ type: 'shutdown_complete' }, '所有活动任务均已完成，进程退出。');
    process.exit(0);
  });
});
