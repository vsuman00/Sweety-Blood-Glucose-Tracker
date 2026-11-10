import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
import { slots } from "../server/dates.js";
import { testDatabaseUrl } from "./helpers/test-database.js";

const pool = makePool(testDatabaseUrl());
const origin = "http://127.0.0.1:5173";
const app = createApp({
  pool,
  secret: "optional-api-test-secret-at-least-32-chars",
  origin,
  now: () => new Date("2026-03-01T10:00:00Z"),
  authLimit: 1000,
});
const alice = request.agent(app),
  bob = request.agent(app);
let aliceId, bobId;
const mutate = (agent, method, path, body) =>
  agent[method](path).set("Origin", origin).send(body);
before(async () => {
  await migrate(pool);
  await pool.query("TRUNCATE users,sessions RESTART IDENTITY CASCADE");
  for (const [agent, name] of [
    [alice, "Pager"],
    [bob, "Other"],
  ]) {
    const body = {
      name,
      email: `${name}@example.test`,
      password: "synthetic-password",
    };
    const result = await mutate(
      agent,
      "post",
      "/api/auth/register",
      body,
    ).expect(201);
    if (agent === alice) aliceId = result.body.user.id;
    else bobId = result.body.user.id;
    await mutate(agent, "post", "/api/auth/login", body).expect(200);
  }
  for (const day of ["2026-02-24", "2026-02-25", "2026-02-26"])
    for (const slot of slots)
      await pool.query(
        "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,$3,100)",
        [aliceId, day, slot],
      );
  await pool.query(
    "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,'2026-02-26','morning_fasting',600)",
    [bobId],
  );
});
after(async () => {
  app.locals.sessionStore.close();
  await pool.end();
});

test("pagination preserves daily shape and pages all owned history in stable order", async () => {
  const first = await alice.get("/api/readings?page=1&limit=5").expect(200);
  assert.deepEqual(first.body.pagination, {
    page: 1,
    limit: 5,
    total: 12,
    totalPages: 3,
  });
  assert.equal(first.body.readings.length, 5);
  assert.deepEqual(
    first.body.readings.slice(0, 4).map((r) => r.slot),
    slots,
  );
  assert.equal(first.body.readings[0].date, "2026-02-26");
  const second = await alice.get("/api/readings?page=2&limit=5").expect(200);
  const third = await alice.get("/api/readings?page=3&limit=5").expect(200);
  assert.equal(
    new Set(
      [
        ...first.body.readings,
        ...second.body.readings,
        ...third.body.readings,
      ].map((r) => r.id),
    ).size,
    12,
  );
  const beyond = await alice.get("/api/readings?page=4&limit=5").expect(200);
  assert.deepEqual(beyond.body.readings, []);
  assert.equal(
    (await bob.get("/api/readings?page=1").expect(200)).body.pagination.total,
    1,
  );
  const daily = await alice.get("/api/readings?date=2026-02-26").expect(200);
  assert.deepEqual(Object.keys(daily.body), ["readings"]);
  assert.equal(daily.body.readings.length, 4);
  const filtered = await alice
    .get("/api/readings?date=2026-02-25&page=2&limit=3")
    .expect(200);
  assert.equal(filtered.body.readings.length, 1);
  assert.equal(filtered.body.pagination.total, 4);
  const empty = await alice
    .get("/api/readings?date=2026-02-01&page=1")
    .expect(200);
  assert.equal(empty.body.pagination.totalPages, 0);
  assert.equal(
    (await alice.get("/api/readings").expect(200)).body.pagination.limit,
    20,
  );
});
test("pagination rejects malformed, repeated, unsafe and oversized parameters", async () => {
  for (const query of [
    "page=0",
    "page=-1",
    "page=1.5",
    "page=1e2",
    "page=one",
    "page=1&page=2",
    "limit=0",
    "limit=101",
    "limit=2&limit=3",
    "page=9007199254740992",
    "page=9007199254740991&limit=100",
    "date=2026-03-02&page=1",
  ])
    await alice.get(`/api/readings?${query}`).expect(400);
  await request(app).get("/api/readings?page=1").expect(401);
});

test("monthly charts return every owned measurement with correct calendar bounds", async () => {
  const feb = await alice.get("/api/reports/monthly?month=2026-02").expect(200);
  assert.equal(feb.body.start, "2026-02-01");
  assert.equal(feb.body.end, "2026-03-01");
  assert.equal(feb.body.readings.length, 12);
  assert.equal(feb.body.readings[0].date, "2026-02-24");
  assert.equal(
    (await bob.get("/api/reports/monthly?month=2026-02").expect(200)).body
      .readings.length,
    1,
  );
  for (const date of ["2024-02-29", "2025-12-31", "2026-01-01", "2026-03-01"])
    await pool.query(
      "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,'morning_fasting',123)",
      [aliceId, date],
    );
  assert.equal(
    (await alice.get("/api/reports/monthly?month=2024-02").expect(200)).body
      .end,
    "2024-03-01",
  );
  assert.equal(
    (await alice.get("/api/reports/monthly?month=2025-12").expect(200)).body
      .readings[0].date,
    "2025-12-31",
  );
  const current = await alice
    .get("/api/reports/monthly?month=2026-03")
    .expect(200);
  assert.equal(current.body.end, "2026-03-02");
  assert.equal(current.body.readings.length, 1);
  assert.deepEqual(
    (await alice.get("/api/reports/monthly?month=2024-01").expect(200)).body
      .readings,
    [],
  );
});
test("monthly charts reject invalid/future months and require authentication", async () => {
  for (const query of [
    "",
    "month=2026-04",
    "month=2026-2",
    "month=2026-13",
    "month=1899-01",
    "month=2026-02&month=2026-01",
  ])
    await alice.get(`/api/reports/monthly?${query}`).expect(400);
  await request(app).get("/api/reports/monthly?month=2026-02").expect(401);
});
