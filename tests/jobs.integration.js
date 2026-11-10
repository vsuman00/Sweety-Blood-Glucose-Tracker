import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { nativeRedis } from "./helpers/native-redis.js";
import { makePool, migrate } from "../server/database.js";
import { testDatabaseUrl } from "./helpers/test-database.js";
import {
  createReminderRuntime,
  registerDailySchedule,
  enqueueDate,
  createReminderQueue,
} from "../server/jobs.js";
import {
  processReminders,
  jobDate,
  previousDate,
} from "../server/reminders.js";

test(
  "real BullMQ schedules idempotently, retries and records one reminder per patient/day",
  { timeout: 20000 },
  async () => {
    assert.ok(process.env.TEST_REDIS_URL, "Use npm run test:jobs:integration");
    const pool = makePool(testDatabaseUrl()),
      prefix = `sweety:test:${randomUUID()}`;
    let runtime, events, eventConnection;
    const now = () => new Date("2026-02-11T01:00:00Z");
    let outage = true;
    try {
      await migrate(pool);
      const id = (
        await pool.query(
          "INSERT INTO users(name,email,password_hash,created_at) VALUES('Queue patient',$1,'test-hash','2026-02-09') RETURNING id",
          [`${randomUUID()}@example.test`],
        )
      ).rows[0].id;
      runtime = await createReminderRuntime({
        pool,
        env: { REDIS_URL: process.env.TEST_REDIS_URL, QUEUE_PREFIX: prefix },
        schedule: false,
        catchUp: false,
        now,
        onEvent: () => {},
        processor: async (job) => {
          if (outage && job.data.date === "2026-02-09")
            throw new Error("Synthetic outage");
          if (job.attemptsMade === 0 && job.data.date === "2026-02-10")
            throw new Error("Synthetic retry");
          return processReminders(pool, jobDate(job), { now: now() });
        },
      });
      await registerDailySchedule(runtime.queue);
      await registerDailySchedule(runtime.queue);
      const schedulers = await runtime.queue.getJobSchedulers();
      assert.equal(schedulers.length, 1);
      assert.equal(schedulers[0].tz, "Asia/Kolkata");
      assert.equal(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(schedulers[0].next)),
        "00:05",
      );
      await runtime.queue.removeJobScheduler("daily-reminders");
      eventConnection = new IORedis(process.env.TEST_REDIS_URL, {
        maxRetriesPerRequest: null,
      });
      events = new QueueEvents(runtime.queue.name, {
        connection: eventConnection,
        prefix,
      });
      await events.waitUntilReady();
      const job = await enqueueDate(runtime.queue, "2026-02-10", now());
      const value = await job.waitUntilFinished(events, 10000);
      assert.equal(value.created, 1);
      assert.equal(
        (await pool.query("SELECT * FROM reminder_logs WHERE user_id=$1", [id]))
          .rowCount,
        1,
      );
      const commands = async () => {
        const info = await runtime.connection.info("stats");
        const match = /^total_commands_processed:(\d+)/m.exec(info);
        return match ? Number(match[1]) : null;
      };
      const before = await commands();
      await delay(2000);
      const after = await commands();
      console.log(
        "Idle Redis sample:",
        JSON.stringify({
          intervalMs: 2000,
          commandDelta:
            before === null || after === null ? null : after - before,
          scope: "isolated test; not a hosted quota estimate",
        }),
      );
      const reloaded = await runtime.queue.getJob(job.id);
      assert.equal(reloaded.attemptsMade, 2);
      const same = await enqueueDate(runtime.queue, "2026-02-10", now());
      assert.equal(same.id, job.id);
      const failed = await enqueueDate(runtime.queue, "2026-02-09", now());
      await assert.rejects(
        failed.waitUntilFinished(events, 10000),
        /Synthetic outage/,
      );
      assert.equal(await failed.getState(), "failed");
      outage = false;
      const recovered = await enqueueDate(runtime.queue, "2026-02-09", now());
      assert.equal(
        (await recovered.waitUntilFinished(events, 10000)).created,
        1,
      );
      assert.equal(
        (await pool.query("SELECT * FROM reminder_logs WHERE user_id=$1", [id]))
          .rowCount,
        2,
      );
      await runtime.closeWorker();
      assert.equal(runtime.worker.isRunning(), false);
    } finally {
      try {
        if (runtime) {
          await runtime.closeWorker();
          await runtime.queue.obliterate({ force: true });
          await runtime.close();
          assert.equal(runtime.connection.status, "end");
        }
      } finally {
        try {
          await events?.close();
        } finally {
          eventConnection?.disconnect();
          await pool.end();
        }
      }
    }
  },
);

test(
  "scheduled jobs use BullMQ timestamps and the worker reconnects after Redis restarts",
  { timeout: 15000 },
  async () => {
    const redis = await nativeRedis(),
      pool = makePool(testDatabaseUrl());
    let runtime;
    try {
      await migrate(pool);
      runtime = await createReminderRuntime({
        pool,
        env: {
          REDIS_URL: redis.url,
          QUEUE_PREFIX: `sweety:reconnect:${randomUUID()}`,
        },
        schedule: false,
        catchUp: false,
        onEvent: () => {},
        processor: async (job) => ({
          date: jobDate(job),
          created: 0,
          scheduled: Number(job.id.split(":").at(-1)),
          explicit: job.data.date !== undefined,
        }),
      });
      const bounded = async (promise) => {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Scheduled/reconnected worker did not process a job.",
                    ),
                  ),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      let completed = new Promise((resolve) =>
        runtime.worker.once("completed", (_job, result) => resolve(result)),
      );
      await runtime.queue.upsertJobScheduler(
        "short-test",
        { every: 1000, limit: 1 },
        { name: "daily-reminders", data: {} },
      );
      const scheduled = await bounded(completed);
      assert.equal(scheduled.explicit, false);
      assert.ok(Number.isSafeInteger(scheduled.scheduled));
      assert.equal(scheduled.date, previousDate(new Date(scheduled.scheduled)));
      await runtime.queue.removeJobScheduler("short-test");
      await redis.stop();
      await delay(100);
      await redis.start();
      const deadline = Date.now() + 5000;
      while (runtime.connection.status !== "ready") {
        assert.ok(Date.now() < deadline, "Producer did not reconnect.");
        await delay(50);
      }
      completed = new Promise((resolve) =>
        runtime.worker.once("completed", (_job, result) => resolve(result)),
      );
      const date = previousDate();
      await enqueueDate(runtime.queue, date);
      assert.equal((await bounded(completed)).date, date);
    } finally {
      try {
        await runtime?.close();
      } finally {
        await redis.close();
        await pool.end();
      }
    }
  },
);

test(
  "worker SIGTERM finishes when Redis is unavailable",
  { timeout: 15000 },
  async () => {
    const redis = await nativeRedis(),
      prefix = `sweety:outage:${randomUUID()}`;
    const pool = makePool(testDatabaseUrl());
    let child,
      workerOutput = "";
    try {
      await migrate(pool);
      child = spawn(process.execPath, ["server/worker.js"], {
        env: {
          ...process.env,
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          REDIS_URL: redis.url,
          QUEUE_PREFIX: prefix,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error("Outage worker startup timed out.")),
          5000,
        );
        child.stdout.on("data", (chunk) => {
          output += chunk;
          workerOutput += chunk;
          if (output.includes("Reminder worker ready.")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stderr.on("data", (chunk) => {
          workerOutput += chunk;
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Outage worker exited early (${code}).`));
        });
      });
      await redis.stop();
      await delay(100);
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      let timer;
      try {
        const [code] = await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Worker did not exit during Redis outage. ${workerOutput}`,
                  ),
                ),
              4500,
            );
          }),
        ]);
        assert.equal(code, 0);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await redis.close();
      await pool.end();
    }
  },
);

test(
  "native worker catches up and exits cleanly on SIGTERM",
  { timeout: 15000 },
  async () => {
    const pool = makePool(testDatabaseUrl()),
      prefix = `sweety:test:${randomUUID()}`;
    let child, producer;
    try {
      await migrate(pool);
      child = spawn(process.execPath, ["server/worker.js"], {
        env: {
          ...process.env,
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          REDIS_URL: process.env.TEST_REDIS_URL,
          QUEUE_PREFIX: prefix,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error(`Worker startup timed out. ${output}`)),
          5000,
        );
        const consume = (chunk) => {
          output += chunk;
          if (output.includes("Reminder worker ready.")) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on("data", consume);
        child.stderr.on("data", consume);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Worker exited early (${code}). ${output}`));
        });
      });
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const [code] = await exited;
      assert.equal(code, 0);
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      try {
        producer = await createReminderQueue({
          REDIS_URL: process.env.TEST_REDIS_URL,
          QUEUE_PREFIX: prefix,
        });
        await producer.queue.obliterate({ force: true });
      } finally {
        await producer?.close();
        await pool.end();
      }
    }
  },
);
