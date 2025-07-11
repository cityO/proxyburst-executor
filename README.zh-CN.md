[English](README.md) | [简体中文](README.zh-CN.md)

# ProxyBurst 执行器 (v2.0) - 分布式网络的“施工队”

欢迎来到 ProxyBurst 系统的引擎室！`proxyburst-executor` 是构成整个分布式处理网络的一个独立的 “工人” (Worker)。

> 需要一个给这支施工队下达指令的“遥控器”吗？请查看 [**`proxyburst-client`**](https://github.com/cityO/proxyburst-client) 仓库来开始你的项目！

## 1. 这是什么？它扮演什么角色？

如果你已经阅读了 `proxyburst-client` 的文档, 你知道客户端的角色是“项目经理助理”, 负责将一个巨大的工程计划 (例如, 10,000 个 API 请求) 分解成独立的工单。

**这个执行器 (`Executor`) 就是接收并完成这些工单的 “施工队成员”。**

它的唯一职责就是：
1.  盯着共享的 “任务板” (Redis 任务队列)。
2.  只要任务板上出现新的工单 (一个独立的 HTTP 请求), 就立刻领取它。
3.  高效地执行这个 HTTP 请求。
4.  将执行结果 (无论是成功还是失败) 报告回去。
5.  返回第一步, 继续等待下一个任务。

**关键在于并行**：你可以同时运行 5 个、50 个、甚至 500 个这样的执行器实例。它们会像一支真正的施工队一样, 同时从任务板上领取不同的工单, 从而将原本需要数小时的串行工作, 在几秒钟内并行完成。

---

## 2. 核心特性

- **🚀 分布式与可伸缩**: 作为“施工队”的一员, 你可以随时增加或减少工人的数量 (即部署更多或更少的执行器实例) 来应对不同的工作负载, 而无需对系统进行任何其他更改。
- **🧩 无状态**: 每个执行器都是独立的, 它不存储任何长期信息。所有的任务状态都由 Redis 统一管理, 这使得系统非常健壮和易于维护。
- **⚙️ 动态配置**: 无需修改任何代码, 你可以通过环境变量轻松配置所有关键参数, 如 Redis 连接地址、队列名称和并发处理能力。
- **❤️ 健康检查**: 内置了一个 `/health` HTTP 接口, 这就像一个工人的健康报告。容器编排系统 (如 Kubernetes) 可以通过定期访问这个接口来确认每个工人是否都在正常工作, 如果有工人“生病”了, 系统就可以自动替换掉它。
- **🌙 优雅停机**: 当你需要关闭一个执行器时, 它不会立即撂挑子走人。相反, 它会“有风度地”先完成手中正在处理的工单, 确保没有任何工作半途而废, 然后再安全退出。

---

## 3. 快速上手: 部署你的第一个工人

### 第 1 步: 安装
在你的服务器或容器环境中, 获取代码并安装依赖。
```bash
# 假设你已经获取了代码
cd proxyburst-executor
npm install
```

### 第 2 步: 配置
执行器通过环境变量进行配置。最简单的方式是创建一个 `.env` 文件。
```bash
# 从模板复制一份配置文件
cp .env.example .env
```
现在, 编辑 `.env` 文件。**最关键的配置是 `REDIS_HOST` 和 `REDIS_PORT`**, 它们必须指向你的 `proxyburst-client` 所连接的同一个 Redis 服务器。

| 环境变量            | 描述                                                                         | 默认值               |
| :------------------ | :--------------------------------------------------------------------------- | :------------------- |
| `REDIS_HOST`        | **必需**: Redis 服务器的地址。                                               | `127.0.0.1`          |
| `REDIS_PORT`        | **必需**: Redis 服务器的端口。                                               | `6379`               |
| `REDIS_PASSWORD`    | Redis 的连接密码（如果没有则留空）。                                         | `(无)`               |
| `QUEUE_NAME`        | **必需**: 监听的任务队列名称, **必须**与客户端的配置完全一致。               | `proxyburst-v2-jobs` |
| `CONCURRENCY`       | 此执行器实例能并发处理的任务数量。可以看作是这个“工人”同时能处理多少张工单。 | `50`                 |
| `LOG_LEVEL`         | 日志输出的详细级别 (`info`, `debug`, `error`)。                              | `info`               |
| `HEALTH_CHECK_PORT` | 健康检查 HTTP 服务器的监听端口。                                             | `3000`               |

### 第 3 步: 启动！
```bash
# 用于生产环境
npm start

# 用于本地开发 (代码变动时会自动重启)
npm run dev
```
一旦启动, 你会看到日志输出, 表明执行器已经连接到 Redis 并开始监听任务。

> **提示**: 在 `proxyburst-client` 目录中运行 `node test-client.js` 可以向队列发送测试任务, 以验证你的执行器是否在正常工作。

---

## 4. Docker 部署 (推荐)

在生产环境中, 我们强烈建议使用 Docker 来运行执行器, 这能确保环境的一致性并简化管理。

### 1. 构建镜像
在 `proxyburst-executor` 目录下, 运行:
```bash
docker build -t proxyburst-executor:latest .
```

### 2. 运行容器
使用 `docker run` 命令来启动一个或多个执行器实例。
```bash
# 启动第一个工人
docker run -d --rm \
  --name executor-1 \
  -e REDIS_HOST=your-redis-ip \
  -e REDIS_PORT=6379 \
  -e QUEUE_NAME=proxyburst-v2-jobs \
  -e CONCURRENCY=100 \
  -p 3001:3000 \
  proxyburst-executor:latest

# 启动第二个工人 (注意端口映射不同)
docker run -d --rm \
  --name executor-2 \
  -e REDIS_HOST=your-redis-ip \
  -e REDIS_PORT=6379 \
  -e QUEUE_NAME=proxyburst-v2-jobs \
  -e CONCURRENCY=100 \
  -p 3002:3000 \
  proxyburst-executor:latest
```
现在你就拥有了一个由两个“工人”组成的施工队, 它们的处理能力是单个实例的两倍！你可以根据需要启动任意多个。