import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makePool, migrate } from "../server/database.js";
import { testDatabaseUrl } from "./helpers/test-database.js";
test("demo seeding creates an assigned doctor and preserves data on rerun", async () => {
  const url = testDatabaseUrl(),
    pool = makePool(url);
  try {
    await migrate(pool);
    const run = () =>
      promisify(execFile)(process.execPath, ["scripts/seed.js"], {
        env: { ...process.env, DATABASE_URL: url },
        timeout: 10000,
      });
    await run();
    const doctor = (
      await pool.query(
        "SELECT id,role FROM users WHERE email='doctor@example.test'",
      )
    ).rows[0];
    assert.equal(doctor.role, "doctor");
    assert.equal(
      (
        await pool.query("SELECT * FROM doctor_patients WHERE doctor_id=$1", [
          doctor.id,
        ])
      ).rowCount,
      1,
    );
    await pool.query(
      "UPDATE readings SET glucose_value=150 WHERE user_id=(SELECT id FROM users WHERE email='demo@example.test')",
    );
    const snapshot = async () => ({
      users: (await pool.query("SELECT * FROM users ORDER BY id")).rows,
      readings: (await pool.query("SELECT * FROM readings ORDER BY id")).rows,
      assignments: (
        await pool.query(
          "SELECT * FROM doctor_patients ORDER BY doctor_id,patient_id",
        )
      ).rows,
    });
    const before = await snapshot();
    await run();
    assert.deepEqual(await snapshot(), before);
  } finally {
    await pool.end();
  }
});
