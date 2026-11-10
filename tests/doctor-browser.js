import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { chromium } from "playwright";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
import { today } from "../server/dates.js";
import { testDatabaseUrl } from "./helpers/test-database.js";

const pool = makePool(testDatabaseUrl()),
  origin = "http://127.0.0.1:3004";
await migrate(pool);
const app = createApp({
  pool,
  origin,
  secret: "doctor-browser-secret-at-least-32-characters",
});
const server = await new Promise((resolve, reject) => {
  const server = app.listen(3004, "127.0.0.1", () => resolve(server));
  server.once("error", reject);
});
const ids = {},
  emails = {},
  suffix = Date.now(),
  date = today(),
  password = "synthetic-password";
let browser;
try {
  const hash = await bcrypt.hash(password, 12);
  for (const [name, role] of [
    ["Patient A", "patient"],
    ["Patient B", "patient"],
    ["Unassigned patient", "patient"],
    ["Doctor", "doctor"],
    ["Unassigned doctor", "doctor"],
  ]) {
    emails[name] =
      `doctor-browser-${name.replaceAll(" ", "-")}-${suffix}@example.test`.toLowerCase();
    ids[name] = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id",
        [name, emails[name], hash, role],
      )
    ).rows[0].id;
  }
  for (const [name, value] of [
    ["Patient A", 111],
    ["Patient B", 222],
    ["Unassigned patient", 333],
  ])
    await pool.query(
      "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,'after_lunch',$3)",
      [ids[name], date, value],
    );
  for (const name of ["Patient A", "Patient B"])
    await pool.query(
      "INSERT INTO doctor_patients(doctor_id,patient_id) VALUES($1,$2)",
      [ids.Doctor, ids[name]],
    );
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function login(name) {
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill(emails[name]);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByRole("heading", { name: `Hello, ${name}.` }).waitFor();
  }
  await login("Doctor");
  await page
    .getByRole("heading", { name: "Reports for Patient A", exact: true })
    .waitFor();
  await page.locator(".reading-number").filter({ hasText: "111" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^(Edit|Delete|Add reading)/ })
      .count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Assigned patient").locator("option").count(),
    2,
  );
  await page.screenshot({
    path: "docs/screenshots/doctor.png",
    fullPage: true,
  });
  await page
    .getByLabel("Assigned patient")
    .selectOption(String(ids["Patient B"]));
  await page.locator(".reading-number").filter({ hasText: "222" }).waitFor();
  assert.equal(
    await page.locator(".reading-number").filter({ hasText: "111" }).count(),
    0,
  );
  await pool.query(
    "DELETE FROM doctor_patients WHERE doctor_id=$1 AND patient_id=$2",
    [ids.Doctor, ids["Patient B"]],
  );
  const yesterday = new Date(`${date}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await page
    .getByLabel("Selected date")
    .fill(yesterday.toISOString().slice(0, 10));
  await page
    .getByRole("alert")
    .filter({ hasText: "Patient not found." })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Daily report", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await login("Unassigned doctor");
  await page
    .getByText("No patients are assigned to you yet.", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Doctor browser passed: assigned patients, read-only reports, switching, revocation and empty assignments.",
  );
} finally {
  await browser?.close();
  if (Object.values(ids).length)
    await pool.query("DELETE FROM users WHERE id=ANY($1::integer[])", [
      Object.values(ids),
    ]);
  app.locals.sessionStore.close();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
