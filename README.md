[English](README.md) | [简体中文](README.zh-CN.md)

# ProxyBurst Executor (v2.0) - The "Construction Crew" of the Distributed Network

Welcome to the engine room of the ProxyBurst system! The `proxyburst-executor` is an independent "Worker" that constitutes the distributed processing network.

## 1. What Is This & What Role Does It Play?

If you've read the `proxyburst-client` documentation, you know the client's role is the "project manager's assistant," responsible for breaking down a massive project (e.g., 10,000 API requests) into individual work orders.

**This Executor is the "construction crew member" that receives and completes those work orders.**

Its sole responsibilities are to:
1.  Watch the shared "job board" (a Redis task queue).
2.  As soon as a new work order (an individual HTTP request) appears on the board, immediately claim it.
3.  Efficiently execute that HTTP request.
4.  Report the result (whether success or failure) back.
5.  Return to step 1 and wait for the next task.

**The key is parallelism**: You can run 5, 50, or even 500 instances of this executor simultaneously. Like a real construction crew, they will all grab different work orders from the job board at the same time, completing what would have been hours of serial work in mere seconds.

> **Need a "remote control" for this crew?** Check out the [**`proxyburst-client`**](https://github.com/cityO/proxyburst-client) repository to get started!

---

## 2. Core Features

- **🚀 Distributed & Scalable**: As a member of the "construction crew," you can add or remove workers (i.e., deploy more or fewer executor instances) at any time to handle different workloads, without any other changes to the system.
- **🧩 Stateless**: Each executor is independent and stores no long-term information. All task states are managed centrally by Redis, making the system highly robust and easy to maintain.
- **⚙️ Dynamic Configuration**: Configure all key parameters, such as Redis connection details, queue names, and concurrency, easily through environment variables without modifying any code.
- **❤️ Health Checks**: Includes a built-in `/health` HTTP endpoint, which acts like a worker's health report. Container orchestration systems (like Kubernetes) can periodically check this endpoint to confirm each worker is functioning correctly and automatically replace any that are "sick."
- **🌙 Graceful Shutdown**: When you need to shut down an executor, it doesn't just drop its tools and leave. Instead, it "gracefully" finishes the work order it's currently handling, ensuring no job is left half-done before safely exiting.

---

## 3. Quick Start: Deploying Your First Worker

### Step 1: Installation
On your server or in your container environment, get the code and install dependencies.
```bash
# Assuming you have the code
cd proxyburst-executor
npm install
```

### Step 2: Configuration
The executor is configured via environment variables. The easiest way is to create a `.env` file.
```bash
# Copy the config file from the template
cp .env.example .env
```
Now, edit the `.env` file. **The most critical settings are `REDIS_HOST` and `REDIS_PORT`**, which must point to the same Redis server your `proxyburst-client` is connected to.

| Environment Variable | Description                                                                                | Default Value        |
| :------------------- | :----------------------------------------------------------------------------------------- | :------------------- |
| `REDIS_HOST`         | **Required**: The address of the Redis server.                                             | `127.0.0.1`          |
| `REDIS_PORT`         | **Required**: The port of the Redis server.                                                | `6379`               |
| `REDIS_PASSWORD`     | The connection password for Redis (leave blank if none).                                   | `(none)`             |
| `QUEUE_NAME`         | **Required**: The name of the task queue to listen on. **Must** match the client's config. | `proxyburst-v2-jobs` |
| `CONCURRENCY`        | The number of tasks this executor instance can process concurrently.                       | `50`                 |
| `LOG_LEVEL`          | The verbosity level for logs (`info`, `debug`, `error`).                                   | `info`               |
| `HEALTH_CHECK_PORT`  | The listening port for the health check HTTP server.                                       | `3000`               |

### Step 3: Launch!
```bash
# For production
npm start

# For local development (restarts automatically on code changes)
npm run dev
```
Once started, you will see log output indicating that the executor has connected to Redis and is listening for tasks.

> **Tip**: Run `node test-client.js` in the `proxyburst-client` directory to send test jobs to the queue and verify that your executor is working correctly.

---

## 4. Docker Deployment (Recommended)

For production environments, we strongly recommend running the executor using Docker. This ensures a consistent environment and simplifies management.

### 1. Build the Image
In the `proxyburst-executor` directory, run:
```bash
docker build -t proxyburst-executor:latest .
```

### 2. Run the Container(s)
Use the `docker run` command to start one or more executor instances.
```bash
# Start the first worker
docker run -d --rm \
  --name executor-1 \
  -e REDIS_HOST=your-redis-ip \
  -e REDIS_PORT=6379 \
  -e QUEUE_NAME=proxyburst-v2-jobs \
  -e CONCURRENCY=100 \
  -p 3001:3000 \
  proxyburst-executor:latest

# Start a second worker (note the different port mapping)
docker run -d --rm \
  --name executor-2 \
  -e REDIS_HOST=your-redis-ip \
  -e REDIS_PORT=6379 \
  -e QUEUE_NAME=proxyburst-v2-jobs \
  -e CONCURRENCY=100 \
  -p 3002:3000 \
  proxyburst-executor:latest
```
You now have a construction crew of two workers, giving you double the processing power of a single instance! You can start as many as you need. 