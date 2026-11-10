import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
import { testDatabaseUrl } from "./helpers/test-database.js";
import { memoryCache } from "./helpers/memory-cache.js";

const pool = makePool(testDatabaseUrl()),
  origin = "http://127.0.0.1:5173",
  cache = memoryCache();
const events = [];
const app = createApp({
  pool,
  origin,
  cache,
  onCacheEvent: (event) => events.push(event),
  secret: "cache-test-secret-at-least-32-characters",
  now: () => new Date("2026-03-01T10:00:00Z"),
});
const alice = request.agent(app),
  bob = request.agent(app);
const mutate = (agent, method, path, body) =>
  agent[method](path).set("Origin", origin).send(body);
after(async () => {
  app.locals.sessionStore.close();
  await pool.end();
});
test("report caches hit, expire, isolate users, invalidate edits and survive outages", async () => {
  await migrate(pool);
  await pool.query("TRUNCATE users,sessions RESTART IDENTITY CASCADE");
  for (const [agent, name] of [
    [alice, "CacheAlice"],
    [bob, "CacheBob"],
  ]) {
    const body = {
      name,
      email: `${name}@example.test`,
      password: "synthetic-password",
    };
    await mutate(agent, "post", "/api/auth/register", body).expect(201);
    await mutate(agent, "post", "/api/auth/login", body).expect(200);
  }
  const report = () => alice.get("/api/reports?date=2026-02-10").expect(200);
  await report();
  await report();
  assert.equal(cache.sets.length, 1);
  assert.equal(cache.gets.length, 2);
  assert.ok(events.includes("hit"));
  const oldKey = cache.sets[0];
  const value = { date: "2026-02-10", slot: "morning_fasting", value: 111 };
  const reading = (
    await mutate(alice, "post", "/api/readings", value).expect(201)
  ).body.reading;
  assert.equal((await report()).body.daily.count, 1);
  assert.notEqual(cache.sets.at(-1), oldKey);
  await mutate(alice, "put", `/api/readings/${reading.id}`, {
    ...value,
    date: "2026-01-01",
    version: 1,
  }).expect(200);
  assert.equal((await report()).body.daily.count, 0);
  assert.equal(
    (await alice.get("/api/reports/monthly?month=2026-01").expect(200)).body
      .readings.length,
    1,
  );
  const before = cache.sets.length;
  await mutate(alice, "post", "/api/readings", {
    ...value,
    date: "2026-01-01",
  }).expect(409);
  await report();
  assert.equal(cache.sets.length, before);
  await bob.get("/api/reports?date=2026-02-10").expect(200);
  assert.notEqual(cache.gets.at(-1), cache.gets.at(-2));
  cache.now += 61000;
  await report();
  assert.equal(cache.sets.length, before + 2);
  const key = cache.sets.at(-1);
  cache.entries.set(key, { value: { daily: "broken" }, expires: Infinity });
  assert.equal((await report()).body.daily.count, 0);
  cache.failGet = true;
  assert.equal((await report()).body.daily.count, 0);
  cache.failGet = false;
  cache.failSet = true;
  await mutate(alice, "post", "/api/readings", value).expect(201);
  assert.equal((await report()).body.daily.count, 1);
  cache.failSet = false;
  await mutate(alice, "delete", `/api/readings/${reading.id}`, {
    version: 2,
  }).expect(204);
  assert.equal(
    (await alice.get("/api/reports/monthly?month=2026-01").expect(200)).body
      .readings.length,
    0,
  );
  assert.ok(events.includes("fallback"));
});
test(
  "a late report fill cannot resurrect data after a committed mutation",
  { timeout: 10000 },
  async () => {
    let captured, release;
    const capturedPromise = new Promise((r) => {
        captured = r;
      }),
      gate = new Promise((r) => {
        release = r;
      });
    const original = pool.query.bind(pool);
    let pause = true;
    pool.query = async (...args) => {
      const result = await original(...args);
      if (
        pause &&
        typeof args[0] === "string" &&
        args[0].startsWith("WITH periods")
      ) {
        pause = false;
        captured();
        await gate;
      }
      return result;
    };
    try {
      const pending = alice.get("/api/reports?date=2026-02-11").then((r) => r);
      await capturedPromise;
      await mutate(alice, "post", "/api/readings", {
        date: "2026-02-11",
        slot: "after_lunch",
        value: 200,
      }).expect(201);
      release();
      assert.equal((await pending).body.daily.count, 0);
      const fresh = await alice.get("/api/reports?date=2026-02-11").expect(200);
      assert.equal(fresh.body.daily.count, 1);
      assert.equal(fresh.body.daily.average, 200);
    } finally {
      release();
      pool.query = original;
    }
  },
);
