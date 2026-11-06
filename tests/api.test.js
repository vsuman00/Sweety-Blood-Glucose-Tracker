import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcrypt";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
import { today, ranges, validDate } from "../server/dates.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("Use a separate TEST_DATABASE_URL ending in _test.");
const pool = makePool(url),
  origin = "http://127.0.0.1:5173";
const app = createApp({
  pool,
  secret: "test-only-secret-with-at-least-32-characters",
  origin,
  now: () => new Date("2026-03-01T10:00:00Z"),
  authLimit: 1000,
});
let alice, bob, aliceId;
const mutate = (agent, method, path, body) =>
  agent[method](path).set("Origin", origin).send(body);
const reading = (
  date = "2026-02-10",
  slot = "morning_fasting",
  value = 100,
) => ({ date, slot, value });
before(async () => {
  await migrate(pool);
  await pool.query("TRUNCATE users,sessions RESTART IDENTITY CASCADE");
  for (const name of ["Alice", "Bob"]) {
    const result = await mutate(request(app), "post", "/api/auth/register", {
      name,
      email: `${name}@example.test`,
      password: "synthetic-password",
    }).expect(201);
    if (name === "Alice") aliceId = result.body.user.id;
  }
  alice = request.agent(app);
  bob = request.agent(app);
  for (const [agent, name] of [
    [alice, "Alice"],
    [bob, "Bob"],
  ])
    await mutate(agent, "post", "/api/auth/login", {
      email: `${name}@example.test`,
      password: "synthetic-password",
    }).expect(200);
});
after(async () => {
  app.locals.sessionStore.close();
  await pool.end();
});
test("calendar arithmetic and Kolkata midnight", () => {
  assert.equal(today(new Date("2026-01-01T18:29:59Z")), "2026-01-01");
  assert.equal(today(new Date("2026-01-01T18:30:00Z")), "2026-01-02");
  assert.deepEqual(ranges("2026-01-15").previousMonth, [
    "2025-12-01",
    "2026-01-01",
  ]);
  assert.deepEqual(ranges("2024-02-29").daily, ["2024-02-29", "2024-03-01"]);
  assert.deepEqual(ranges("2025-03-01").previousMonth, [
    "2025-02-01",
    "2025-03-01",
  ]);
  assert.equal(validDate("2025-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
});
test("accounts hash passwords, normalize email, and protect sessions", async () => {
  const { rows } = await pool.query(
    "SELECT password_hash FROM users WHERE id=$1",
    [aliceId],
  );
  assert.notEqual(rows[0].password_hash, "synthetic-password");
  assert.equal(
    await bcrypt.compare("synthetic-password", rows[0].password_hash),
    true,
  );
  await mutate(request(app), "post", "/api/auth/register", {
    name: "Again",
    email: " ALICE@example.test ",
    password: "synthetic-password",
  }).expect(409);
  await mutate(request(app), "post", "/api/auth/register", {
    name: "",
    email: "bad",
    password: "short",
  }).expect(400);
  await mutate(request(app), "post", "/api/auth/register", {
    name: "Long",
    email: "long@example.test",
    password: "😀".repeat(20),
  }).expect(400);
  await mutate(request(app), "post", "/api/auth/login", {
    email: "alice@example.test",
    password: "wrong-password",
  }).expect(401);
  await request(app).get("/api/readings?date=2026-02-10").expect(401);
  const me = await alice.get("/api/auth/me").expect(200);
  assert.equal(me.body.user.password_hash, undefined);
  const login = request.agent(app);
  const response = await mutate(login, "post", "/api/auth/login", {
    email: "alice@example.test",
    password: "synthetic-password",
  }).expect(200);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.match(response.headers["set-cookie"][0], /SameSite=Lax/);
  await mutate(login, "post", "/api/auth/logout", {}).expect(204);
  await login.get("/api/auth/me").expect(401);
  await alice
    .post("/api/readings")
    .set("Origin", "http://evil.test")
    .send(reading())
    .expect(403);
});
test("create and edit enforce identical validation", async () => {
  const existing = await mutate(
    alice,
    "post",
    "/api/readings",
    reading("2026-02-01"),
  ).expect(201);
  for (const patch of [
    { value: 39 },
    { value: 601 },
    { value: 40.5 },
    { value: "100" },
    { value: null },
    { slot: "snack" },
    { date: "2026-02-30" },
    { date: "2026-03-02" },
    { date: "2026-2-01" },
    { date: "1899-12-31" },
  ]) {
    await mutate(alice, "post", "/api/readings", {
      ...reading("2026-02-02"),
      ...patch,
    }).expect(400);
    await mutate(alice, "put", `/api/readings/${existing.body.reading.id}`, {
      ...reading("2026-02-01"),
      version: 1,
      ...patch,
    }).expect(400);
  }
  for (const [slot, value] of [
    ["after_breakfast", 40],
    ["after_lunch", 600],
  ])
    await mutate(
      alice,
      "post",
      "/api/readings",
      reading("2026-02-01", slot, value),
    ).expect(201);
});
test("four slots, duplicate edits, concurrent creates and recreation", async () => {
  const date = "2026-02-03";
  const first = await mutate(
    alice,
    "post",
    "/api/readings",
    reading(date),
  ).expect(201);
  for (const slot of ["after_breakfast", "after_lunch", "after_dinner"])
    await mutate(alice, "post", "/api/readings", reading(date, slot)).expect(
      201,
    );
  await mutate(alice, "post", "/api/readings", reading(date)).expect(409);
  await mutate(alice, "put", `/api/readings/${first.body.reading.id}`, {
    ...reading(date, "after_breakfast"),
    version: 1,
  }).expect(409);
  const unchanged = await alice.get(`/api/readings?date=${date}`);
  assert.equal(unchanged.body.readings[0].version, 1);
  const races = await Promise.all(
    [1, 2].map(() =>
      mutate(alice, "post", "/api/readings", reading("2026-02-04")),
    ),
  );
  assert.deepEqual(races.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await alice.get("/api/readings?date=2026-02-04")).body.readings.length,
    1,
  );
  await mutate(alice, "delete", `/api/readings/${first.body.reading.id}`, {
    version: 1,
  }).expect(204);
  await mutate(alice, "post", "/api/readings", reading(date)).expect(201);
});
test("isolation applies to reads, updates, deletes, reports and injected ownership", async () => {
  const created = await mutate(alice, "post", "/api/readings", {
    ...reading("2026-02-05"),
    user_id: 999,
    userId: 999,
  }).expect(201);
  const id = created.body.reading.id;
  assert.equal(
    (await bob.get("/api/readings?date=2026-02-05")).body.readings.length,
    0,
  );
  await mutate(bob, "put", `/api/readings/${id}`, {
    ...reading("2026-02-05"),
    version: 1,
  }).expect(404);
  await mutate(bob, "delete", `/api/readings/${id}`, { version: 1 }).expect(
    404,
  );
  assert.equal(
    (await bob.get("/api/reports?date=2026-02-05")).body.daily.count,
    0,
  );
  await mutate(bob, "post", "/api/readings", reading("2026-02-05")).expect(201);
});
test("concurrent edits and stale deletes cannot overwrite new data", async () => {
  const { body } = await mutate(
    alice,
    "post",
    "/api/readings",
    reading("2026-02-06"),
  ).expect(201);
  const path = `/api/readings/${body.reading.id}`;
  const responses = await Promise.all(
    [110, 120].map((value) =>
      mutate(alice, "put", path, {
        ...reading("2026-02-06", "morning_fasting", value),
        version: 1,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  await mutate(alice, "delete", path, { version: 1 }).expect(409);
  await mutate(alice, "delete", path, { version: 2 }).expect(204);
  await mutate(alice, "put", path, {
    ...reading("2026-02-06"),
    version: 2,
  }).expect(404);
});
test("reports use calendar periods, empty states, owner filters and numeric rounding", async () => {
  const agent = bob;
  for (const [date, slot, value] of [
    ["2025-12-31", "morning_fasting", 600],
    ["2026-01-01", "morning_fasting", 40],
    ["2026-01-15", "morning_fasting", 100],
    ["2026-01-15", "after_breakfast", 100],
    ["2026-01-15", "after_lunch", 101],
    ["2026-01-16", "morning_fasting", 500],
    ["2026-02-15", "morning_fasting", 100],
    ["2026-02-15", "after_breakfast", 101],
    ["2026-02-15", "after_lunch", 101],
    ["2026-02-15", "after_dinner", 101],
  ])
    await mutate(
      agent,
      "post",
      "/api/readings",
      reading(date, slot, value),
    ).expect(201);
  const { body } = await agent.get("/api/reports?date=2026-01-15").expect(200);
  assert.deepEqual(
    [
      body.daily.highest,
      body.daily.lowest,
      body.daily.average,
      body.daily.count,
    ],
    [101, 100, 100.3, 3],
  );
  assert.equal(body.monthToDate.count, 4);
  assert.equal(body.monthToDate.highest, 101);
  assert.equal(body.previousMonth.count, 1);
  assert.equal(body.previousMonth.highest, 600);
  assert.deepEqual(
    body.daily.readings.map((r) => r.slot),
    ["morning_fasting", "after_breakfast", "after_lunch"],
  );
  assert.equal(
    (await agent.get("/api/reports?date=2026-02-15")).body.daily.average,
    100.8,
  );
  const empty = (await agent.get("/api/reports?date=2024-03-01")).body;
  for (const period of Object.values(empty)) {
    assert.equal(period.count, 0);
    assert.equal(period.average, null);
    assert.equal(period.highest, null);
    assert.equal(period.lowest, null);
  }
  await agent.get("/api/reports?date=2026-03-02").expect(400);
});
test("database constraints reject bypasses", async () => {
  await assert.rejects(
    pool.query(
      "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,'2026-02-20','bad',100)",
      [aliceId],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,'2026-02-20','morning_fasting',601)",
      [aliceId],
    ),
    { code: "23514" },
  );
});

test("malformed request bodies return clear errors and login ignores unrelated fields", async () => {
  await alice.post("/api/readings").set("Origin", origin).send([]).expect(400);
  await alice
    .post("/api/readings")
    .set("Origin", origin)
    .set("Content-Type", "application/json")
    .send("{bad")
    .expect(400);
  await alice.post("/api/readings").set("Origin", origin).expect(400);
  await mutate(request(app), "post", "/api/auth/login", {
    email: "alice@example.test",
    password: "synthetic-password",
    name: 123,
  }).expect(200);
});
