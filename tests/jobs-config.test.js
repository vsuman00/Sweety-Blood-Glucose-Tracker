import { test } from "node:test";
import assert from "node:assert/strict";
import { queueConfig, enqueueDate } from "../server/jobs.js";

test("queue configuration requires an isolated prefix and TLS for remote Redis", () => {
  assert.equal(
    queueConfig({
      REDIS_URL: "redis://127.0.0.1:6379",
      QUEUE_PREFIX: "sweety:test:jobs",
    }).prefix,
    "sweety:test:jobs",
  );
  assert.ok(
    queueConfig({
      REDIS_URL: "rediss://default:test-password@redis.example.test:6379",
      QUEUE_PREFIX: "sweety:test:jobs",
    }).url.startsWith("rediss://"),
  );
  for (const env of [
    {},
    { REDIS_URL: "https://cache.example.test", QUEUE_PREFIX: "test" },
    { REDIS_URL: "redis://remote.example.test", QUEUE_PREFIX: "test" },
    { REDIS_URL: "redis://localhost:6379", QUEUE_PREFIX: "" },
  ])
    assert.throws(() => queueConfig(env), /REDIS_URL|QUEUE_PREFIX/);
});
test("manual reminders validate a completed date before adding a stable job", async () => {
  const calls = [],
    queue = {
      add: async (...args) => {
        calls.push(args);
        return { id: args[2].jobId, getState: async () => "waiting" };
      },
    },
    now = new Date("2026-02-11T00:00:00Z");
  for (const date of ["2026-02-11", "2026-02-30", "invalid"])
    await assert.rejects(enqueueDate(queue, date, now), /completed/);
  assert.equal(calls.length, 0);
  assert.equal(
    (await enqueueDate(queue, "2026-02-10", now)).id,
    "reminders-2026-02-10",
  );
  assert.equal(calls[0][1].date, "2026-02-10");
  assert.equal(calls[0][2].attempts, 3);
});
