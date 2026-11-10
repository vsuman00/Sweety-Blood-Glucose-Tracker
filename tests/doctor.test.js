import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
import { setRole, assignPatient, unassignPatient } from "../server/access.js";
import { testDatabaseUrl } from "./helpers/test-database.js";
import { memoryCache } from "./helpers/memory-cache.js";

const pool = makePool(testDatabaseUrl()),
  origin = "http://127.0.0.1:5173",
  cache = memoryCache("sweety:doctors");
const app = createApp({
  pool,
  cache,
  onCacheEvent: () => {},
  origin,
  secret: "doctor-test-secret-at-least-32-characters",
  now: () => new Date("2026-03-01T10:00:00Z"),
  authLimit: 1000,
});
const agents = {},
  ids = {};
const email = (name) => `${name}@example.test`;
const mutate = (agent, method, path, body) =>
  agent[method](path).set("Origin", origin).send(body);
before(async () => {
  await migrate(pool);
  await pool.query("TRUNCATE users,sessions RESTART IDENTITY CASCADE");
  for (const name of ["patient", "unassigned", "doctor", "otherdoctor"]) {
    agents[name] = request.agent(app);
    const body = {
      name,
      email: email(name),
      password: "synthetic-password",
      role: "doctor",
    };
    const response = await mutate(
      agents[name],
      "post",
      "/api/auth/register",
      body,
    ).expect(201);
    assert.equal(response.body.user.role, "patient");
    ids[name] = response.body.user.id;
    await mutate(agents[name], "post", "/api/auth/login", body).expect(200);
  }
  await setRole(pool, email("doctor"), "doctor");
  await setRole(pool, email("otherdoctor"), "doctor");
  await assignPatient(pool, email("doctor"), email("patient"));
  await mutate(agents.patient, "post", "/api/readings", {
    date: "2026-02-10",
    slot: "after_lunch",
    value: 112,
  }).expect(201);
});
after(async () => {
  app.locals.sessionStore.close();
  await pool.end();
});
test("doctors see only assigned names and reports; patients keep private CRUD", async () => {
  assert.equal(
    (await agents.doctor.get("/api/auth/me").expect(200)).body.user.role,
    "doctor",
  );
  const list = (
    await agents.doctor.get("/api/doctor/patients?page=1&limit=1").expect(200)
  ).body;
  assert.deepEqual(list.patients, [{ id: ids.patient, name: "patient" }]);
  assert.equal(list.pagination.total, 1);
  assert.deepEqual(
    (await agents.otherdoctor.get("/api/doctor/patients").expect(200)).body
      .patients,
    [],
  );
  const path = `/api/doctor/patients/${ids.patient}/reports`;
  assert.equal(
    (await agents.doctor.get(`${path}?date=2026-02-10`).expect(200)).body.daily
      .average,
    112,
  );
  await agents.doctor.get(`${path}?date=2026-02-10`).expect(200);
  assert.equal(
    (await agents.doctor.get(`${path}/monthly?month=2026-02`).expect(200)).body
      .readings.length,
    1,
  );
  await agents.otherdoctor.get(`${path}?date=2026-02-10`).expect(404);
  await agents.doctor
    .get(`/api/doctor/patients/${ids.unassigned}/reports?date=2026-02-10`)
    .expect(404);
  await agents.patient.get(`${path}?date=2026-02-10`).expect(403);
  await request(app).get(`${path}?date=2026-02-10`).expect(401);
  await agents.doctor.get("/api/readings?page=1").expect(403);
  await agents.doctor.get("/api/reports?date=2026-02-10").expect(403);
  await mutate(agents.doctor, "post", "/api/readings", {
    user_id: ids.patient,
    date: "2026-02-11",
    slot: "after_lunch",
    value: 200,
  }).expect(403);
  for (const id of ["-1", "0", "abc", "999999999999999999999", "99999"])
    await agents.doctor
      .get(`/api/doctor/patients/${id}/reports?date=2026-02-10`)
      .expect(404);
  await agents.doctor.get("/api/doctor/patients?page=0").expect(400);
});
test("revocation and role changes block warmed caches on the next request", async () => {
  const path = `/api/doctor/patients/${ids.patient}/reports?date=2026-02-10`;
  await agents.doctor.get(path).expect(200);
  const gets = cache.gets.length;
  await unassignPatient(pool, email("doctor"), email("patient"));
  await agents.doctor.get(path).expect(404);
  assert.equal(cache.gets.length, gets);
  await assignPatient(pool, email("doctor"), email("patient"));
  await assert.rejects(
    assignPatient(pool, email("doctor"), email("patient")),
    /already assigned/i,
  );
  await setRole(pool, email("doctor"), "patient");
  await agents.doctor.get(path).expect(403);
  assert.equal(
    (await agents.doctor.get("/api/auth/me").expect(200)).body.user.role,
    "patient",
  );
  assert.equal(
    (
      await pool.query("SELECT * FROM doctor_patients WHERE doctor_id=$1", [
        ids.doctor,
      ])
    ).rowCount,
    0,
  );
});
test("trusted role/assignment commands reject invalid relationships and preserve readings", async () => {
  await assert.rejects(setRole(pool, email("patient"), "admin"), /role/i);
  await assert.rejects(
    assignPatient(pool, email("patient"), email("patient")),
    /different|doctor/i,
  );
  await assert.rejects(
    assignPatient(pool, email("patient"), email("otherdoctor")),
    /doctor|patient/,
  );
  await assert.rejects(
    assignPatient(pool, email("otherdoctor"), "missing@example.test"),
    /account/i,
  );
  await setRole(pool, email("patient"), "doctor");
  assert.equal(
    (await pool.query("SELECT * FROM readings WHERE user_id=$1", [ids.patient]))
      .rowCount,
    1,
  );
  await setRole(pool, email("patient"), "patient");
  assert.equal(
    (await agents.patient.get("/api/readings?date=2026-02-10").expect(200)).body
      .readings.length,
    1,
  );
});
