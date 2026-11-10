import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
import { testDatabaseUrl } from "./helpers/test-database.js";

const pool = makePool(testDatabaseUrl()),
  origin = "http://127.0.0.1:5173";
const app = createApp({
  pool,
  origin,
  secret: "revision-test-secret-at-least-32-characters",
  now: () => new Date("2026-03-01T10:00:00Z"),
});
const agent = request.agent(app);
const mutate = (method, path, body) =>
  agent[method](path).set("Origin", origin).send(body);
after(async () => {
  app.locals.sessionStore.close();
  await pool.end();
});
test("report revision changes only with committed writes and rolls back on failure", async () => {
  await migrate(pool);
  await pool.query("TRUNCATE users,sessions RESTART IDENTITY CASCADE");
  const account = {
    name: "Revision",
    email: "revision@example.test",
    password: "synthetic-password",
  };
  const { body } = await mutate("post", "/api/auth/register", account).expect(
    201,
  );
  await mutate("post", "/api/auth/login", account).expect(200);
  const revision = async () =>
    (
      await pool.query("SELECT report_revision FROM users WHERE id=$1", [
        body.user.id,
      ])
    ).rows[0].report_revision;
  assert.equal(await revision(), "0");
  const value = { date: "2026-02-10", slot: "morning_fasting", value: 111 };
  const reading = (await mutate("post", "/api/readings", value).expect(201))
    .body.reading;
  assert.equal(await revision(), "1");
  await mutate("post", "/api/readings", value).expect(409);
  await mutate("post", "/api/readings", {
    ...value,
    date: "2026-03-02",
  }).expect(400);
  assert.equal(await revision(), "1");
  await mutate("put", `/api/readings/${reading.id}`, {
    ...value,
    date: "2026-01-01",
    version: 1,
  }).expect(200);
  assert.equal(await revision(), "2");
  await mutate("put", `/api/readings/${reading.id}`, {
    ...value,
    version: 1,
  }).expect(409);
  await mutate("delete", `/api/readings/${reading.id}`, { version: 1 }).expect(
    409,
  );
  assert.equal(await revision(), "2");
  await mutate("delete", `/api/readings/${reading.id}`, { version: 2 }).expect(
    204,
  );
  assert.equal(await revision(), "3");
  await pool.query(
    "CREATE FUNCTION reject_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic revision failure'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER reject_revision BEFORE UPDATE OF report_revision ON users FOR EACH ROW EXECUTE FUNCTION reject_revision()",
  );
  try {
    await mutate("post", "/api/readings", value).expect(500);
    assert.equal(
      (
        await pool.query("SELECT id FROM readings WHERE user_id=$1", [
          body.user.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(await revision(), "3");
  } finally {
    await pool.query("DROP TRIGGER reject_revision ON users");
    await pool.query("DROP FUNCTION reject_revision()");
  }
});
