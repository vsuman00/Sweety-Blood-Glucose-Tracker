import { test, after } from "node:test";
import assert from "node:assert/strict";
import { makePool, migrate } from "../server/database.js";
import { testDatabaseUrl } from "./helpers/test-database.js";
import {
  processReminders,
  previousDate,
  jobDate,
} from "../server/reminders.js";

const pool = makePool(testDatabaseUrl());
after(() => pool.end());
test("reminder dates use completed IST days and remain fixed across retries", () => {
  assert.equal(previousDate(new Date("2026-01-01T18:30:00Z")), "2026-01-01");
  assert.equal(previousDate(new Date("2026-01-01T18:29:59Z")), "2025-12-31");
  assert.equal(previousDate(new Date("2024-02-29T18:35:00Z")), "2024-02-29");
  const job = {
    data: {},
    repeatJobKey: "daily-reminders",
    id: `repeat:daily-reminders:${Date.parse("2026-01-01T18:35:00Z")}`,
    opts: {},
  };
  assert.equal(jobDate(job), "2026-01-01");
  assert.equal(jobDate({ ...job, attemptsMade: 2 }), "2026-01-01");
  assert.equal(
    jobDate({ data: { date: "2024-02-29" }, opts: {} }),
    "2024-02-29",
  );
  assert.throws(() => jobDate({ data: {}, opts: {} }), /scheduled|date/i);
});
test("reminders log zero-to-three readings, exclude doctors/new users, and deduplicate retries", async () => {
  await migrate(pool);
  await pool.query("TRUNCATE users,sessions RESTART IDENTITY CASCADE");
  const date = "2026-02-10",
    ids = [];
  for (const [name, role, created] of [
    ["zero", "patient", "2026-02-09"],
    ["one", "patient", "2026-02-09"],
    ["three", "patient", "2026-02-09"],
    ["four", "patient", "2026-02-09"],
    ["doctor", "doctor", "2026-02-09"],
    ["new", "patient", "2026-02-11"],
  ]) {
    const id = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role,created_at) VALUES($1,$2,'test-hash',$3,$4) RETURNING id",
        [name, `${name}@example.test`, role, created],
      )
    ).rows[0].id;
    ids.push(id);
    const count = { one: 1, three: 3, four: 4 }[name] || 0;
    for (const slot of [
      "morning_fasting",
      "after_breakfast",
      "after_lunch",
      "after_dinner",
    ].slice(0, count))
      await pool.query(
        "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,$3,100)",
        [id, date, slot],
      );
  }
  const result = await processReminders(pool, date, {
    now: new Date("2026-02-11T00:00:00Z"),
    batchSize: 2,
  });
  assert.equal(result.created, 3);
  const [a, b] = await Promise.all([
    processReminders(pool, date, { now: new Date("2026-02-11") }),
    processReminders(pool, date, { now: new Date("2026-02-11") }),
  ]);
  assert.equal(a.created + b.created, 0);
  const { rows } = await pool.query(
    "SELECT u.name,r.reading_count FROM reminder_logs r JOIN users u ON u.id=r.user_id ORDER BY u.name",
  );
  assert.deepEqual(rows, [
    { name: "one", reading_count: 1 },
    { name: "three", reading_count: 3 },
    { name: "zero", reading_count: 0 },
  ]);
  for (const invalid of ["2026-02-11", "2026-02-30", "invalid"])
    await assert.rejects(
      processReminders(pool, invalid, {
        now: new Date("2026-02-11T00:00:00Z"),
      }),
      /completed|valid/i,
    );
});
