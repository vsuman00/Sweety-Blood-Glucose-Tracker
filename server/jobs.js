import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { today, validDate, TIMEZONE } from "./dates.js";
import { processReminders, previousDate, jobDate } from "./reminders.js";

const queueName = "daily-reminders";
const jobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 7 * 86400, count: 100 },
  removeOnFail: { age: 30 * 86400, count: 100 },
};
export function queueConfig(env = process.env) {
  let url;
  try {
    url = new URL(env.REDIS_URL);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "rediss:" && !(local && url.protocol === "redis:"))
      throw new Error();
    if (url.search || url.hash) throw new Error();
  } catch {
    throw new Error(
      "Set REDIS_URL to an Upstash TCP/TLS rediss:// URL or a local redis:// URL.",
    );
  }
  if (
    typeof env.QUEUE_PREFIX !== "string" ||
    !/^[a-z0-9:_-]{1,100}$/.test(env.QUEUE_PREFIX)
  )
    throw new Error("Set a unique QUEUE_PREFIX for this environment.");
  return { url: url.href, prefix: env.QUEUE_PREFIX };
}
function connect(url, worker, onEvent) {
  const connection = new IORedis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
  connection.on("error", (error) =>
    onEvent({ event: "redis_error", code: error.code || error.name }),
  );
  return connection;
}
async function closeConnection(connection) {
  if (connection.status === "end") return;
  if (connection.status !== "ready") {
    connection.disconnect();
    return;
  }
  let onEnd;
  const ended = new Promise((resolve) => {
    onEnd = resolve;
    connection.once("end", resolve);
  });
  let timer;
  try {
    if (connection.status === "ready")
      await Promise.race([
        connection.quit(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
  } catch {
    // An unavailable Redis service must not prevent this client from closing.
  } finally {
    clearTimeout(timer);
    connection.disconnect();
    try {
      await Promise.race([
        ended,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 100);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      connection.removeListener("end", onEnd);
    }
  }
}
export async function createReminderQueue(
  env = process.env,
  onEvent = () => {},
) {
  const { url, prefix } = queueConfig(env);
  const connection = connect(url, false, onEvent);
  let queue;
  try {
    await connection.connect();
    const info = await connection.info("memory");
    if (!/^maxmemory_policy:noeviction\r?$/m.test(info))
      throw new Error(
        "Redis eviction must be disabled for BullMQ; cannot confirm noeviction.",
      );
    queue = new Queue(queueName, {
      connection,
      prefix,
      defaultJobOptions: jobOptions,
    });
    await queue.waitUntilReady();
    let closing;
    return {
      queue,
      connection,
      prefix,
      url,
      close: () =>
        (closing ||= (async () => {
          try {
            await queue.close();
          } finally {
            await closeConnection(connection);
            onEvent({ event: "worker_connection_closed" });
          }
        })()),
    };
  } catch (error) {
    await queue?.close();
    connection.disconnect();
    throw error;
  }
}
export async function registerDailySchedule(queue) {
  return queue.upsertJobScheduler(
    "daily-reminders",
    { pattern: "0 5 0 * * *", tz: TIMEZONE },
    { name: "daily-reminders", data: {}, opts: jobOptions },
  );
}
export async function enqueueDate(queue, date, now = new Date()) {
  if (!validDate(date) || date >= today(now))
    throw new Error("Choose a valid completed reading day.");
  const job = await queue.add(
    "daily-reminders",
    { date },
    { ...jobOptions, jobId: `reminders-${date}` },
  );
  if ((await job.getState()) === "failed") {
    try {
      await job.retry("failed", {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    } catch (error) {
      if ((await job.getState()) === "failed") throw error;
    }
  }
  return job;
}
export async function createReminderRuntime({
  pool,
  env = process.env,
  schedule = true,
  catchUp = true,
  now = () => new Date(),
  onEvent = (event) => console.info(JSON.stringify(event)),
  processor,
} = {}) {
  const producer = await createReminderQueue(env, onEvent);
  const connection = connect(producer.url, true, onEvent);
  let worker;
  try {
    await connection.connect();
    worker = new Worker(
      queueName,
      async (job) => {
        const result = await (processor
          ? processor(job)
          : processReminders(pool, jobDate(job), { now: now() }));
        onEvent({
          event: "reminder_run",
          date: result.date,
          created: result.created,
        });
        return result;
      },
      { connection, prefix: producer.prefix, concurrency: 1 },
    );
    worker.on("error", (error) =>
      onEvent({ event: "worker_error", code: error.code || error.name }),
    );
    worker.on("failed", (job, error) =>
      onEvent({
        event: "reminder_failed",
        attempts: job?.attemptsMade,
        code: error.code || error.name,
      }),
    );
    await worker.waitUntilReady();
    if (schedule) await registerDailySchedule(producer.queue);
    if (catchUp) await enqueueDate(producer.queue, previousDate(now()), now());
    async function closeWorker() {
      const stopped = worker.close(connection.status !== "ready");
      let timer;
      try {
        const graceful = await Promise.race([
          stopped.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), 2000);
          }),
        ]);
        if (!graceful) {
          onEvent({ event: "worker_forced_disconnect" });
          await worker.backend.close(true);
          connection.disconnect();
        }
      } finally {
        clearTimeout(timer);
      }
    }
    let closing;
    return {
      ...producer,
      worker,
      closeWorker,
      close: () =>
        (closing ||= (async () => {
          onEvent({ event: "worker_closing" });
          await closeWorker();
          onEvent({ event: "worker_stopped" });
          try {
            await closeConnection(connection);
            onEvent({ event: "worker_connection_closed" });
          } finally {
            await producer.close();
            onEvent({ event: "queue_connection_closed" });
          }
        })()),
    };
  } catch (error) {
    await worker?.close();
    connection.disconnect();
    await producer.close();
    throw error;
  }
}
