import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";
import { createCache } from "../server/cache.js";
import { createApp } from "../server/app.js";
import { makePool, migrate } from "../server/database.js";
import { today } from "../server/dates.js";
import { testDatabaseUrl } from "./helpers/test-database.js";
import { cleanupLiveCache } from "./helpers/cleanup-cache.js";

if (
  !process.env.TEST_UPSTASH_REDIS_REST_URL ||
  !process.env.TEST_UPSTASH_REDIS_REST_TOKEN
) {
  console.error(
    "PENDING: set TEST_UPSTASH_REDIS_REST_URL and TEST_UPSTASH_REDIS_REST_TOKEN for live cache verification.",
  );
  process.exit(2);
}
const cache = createCache({
  UPSTASH_REDIS_REST_URL: process.env.TEST_UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.TEST_UPSTASH_REDIS_REST_TOKEN,
  CACHE_NAMESPACE: `sweety:test:${randomUUID()}`,
});
const keys = new Set();
const tracked = {
  ...cache,
  async set(key, ...args) {
    keys.add(key);
    return cache.set(key, ...args);
  },
};
const pool = makePool(testDatabaseUrl()),
  origin = "http://127.0.0.1:5173",
  events = [];
const app = createApp({
  pool,
  cache: tracked,
  origin,
  secret: "live-cache-test-secret-at-least-32-chars",
  onCacheEvent: (event) => events.push(event),
});
const agent = request.agent(app),
  date = today();
let userId;
try {
  await migrate(pool);
  const account = {
    name: "Cache smoke",
    email: `cache-${randomUUID()}@example.test`,
    password: randomUUID(),
  };
  userId = (
    await agent
      .post("/api/auth/register")
      .set("Origin", origin)
      .send(account)
      .expect(201)
  ).body.user.id;
  await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send(account)
    .expect(200);
  const read = () => agent.get(`/api/reports?date=${date}`).expect(200);
  await read();
  await read();
  assert.ok(events.includes("hit"), "A real Upstash cache hit is required");
  const reading = (
    await agent
      .post("/api/readings")
      .set("Origin", origin)
      .send({ date, slot: "morning_fasting", value: 123 })
      .expect(201)
  ).body.reading;
  assert.equal((await read()).body.daily.count, 1);
  await agent
    .delete(`/api/readings/${reading.id}`)
    .set("Origin", origin)
    .send({ version: 1 })
    .expect(204);
  assert.equal((await read()).body.daily.count, 0);
  const expiryKey = `${cache.namespace}:expiry`;
  await tracked.set(expiryKey, { ok: true }, 1);
  assert.deepEqual(await cache.get(expiryKey), { ok: true });
  const deadline = Date.now() + 5000;
  while ((await cache.get(expiryKey)) !== null) {
    assert.ok(Date.now() < deadline, "TTL did not expire");
    await delay(250);
  }
  console.log(
    "Live Upstash passed: hit, TTL expiry, create/delete invalidation.",
  );
} finally {
  await cleanupLiveCache({
    cache,
    keys,
    userId,
    pool,
    store: app.locals.sessionStore,
  });
}
