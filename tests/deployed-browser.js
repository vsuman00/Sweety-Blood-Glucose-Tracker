import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { makePool } from "../server/database.js";

const origin = new URL(process.argv[2]).origin;
assert.equal(new URL(origin).protocol, "https:");
const pool = process.env.DEPLOYMENT_TEST_DATABASE_URL
  ? makePool(process.env.DEPLOYMENT_TEST_DATABASE_URL)
  : null;
const email = `deployment-${randomUUID()}@example.test`,
  password = randomUUID();
let browser, page;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${origin}/**`, async (route) => {
    const headers = { ...route.request().headers() };
    if (process.env.VERCEL_OIDC_TOKEN)
      headers["x-vercel-trusted-oidc-idp-token"] =
        process.env.VERCEL_OIDC_TOKEN;
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
      headers["x-vercel-protection-bypass"] =
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (
      process.env.DEPLOYMENT_APP_ORIGIN &&
      !["GET", "HEAD", "OPTIONS"].includes(route.request().method())
    ) {
      headers.origin = process.env.DEPLOYMENT_APP_ORIGIN;
      try {
        const response = await route.fetch({ headers, maxRedirects: 0 });
        await route.fulfill({ response });
      } catch {
        throw new Error(
          `Staged browser request failed: ${route.request().method()} ${new URL(route.request().url()).pathname}`,
        );
      }
      return;
    }
    await route.continue({ headers });
  });
  async function login(account) {
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill(account);
    await page.getByLabel("Password", { exact: true }).fill("Sweety-demo-2026");
    const response = page.waitForResponse(
      (item) => new URL(item.url()).pathname === "/api/auth/login",
    );
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    assert.equal((await response).status(), 200, "Browser login");
  }
  async function logout() {
    const response = page.waitForResponse(
      (item) => new URL(item.url()).pathname === "/api/auth/logout",
    );
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    assert.equal((await response).status(), 204, "Browser logout");
    await page.getByRole("button", { name: "Log in", exact: true }).waitFor();
  }
  await login("demo@example.test");
  await page
    .getByRole("heading", { name: "Add a reading", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Daily report", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Reading history", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Monthly glucose chart", exact: true })
    .waitFor();
  await page.locator(".history-panel[aria-busy=false]").waitFor();
  await page.locator(".chart-panel[aria-busy=false]").waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.screenshot({
    path: "docs/screenshots/deployed-dashboard.png",
    fullPage: true,
  });
  await logout();
  if (pool) {
    await page
      .getByRole("button", { name: "New here? Create an account", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Deployment Test");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Hello, Deployment Test.", exact: true })
      .waitFor();
    await page.getByLabel("Glucose (mg/dl)", { exact: true }).fill("123");
    await page
      .getByRole("button", { name: "Add reading", exact: true })
      .click();
    await page.getByText("Reading added.", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Edit Morning (fasting)", exact: true })
      .click();
    await page.getByLabel("Glucose (mg/dl)", { exact: true }).fill("124");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page.getByText("Reading updated.", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Delete Morning (fasting)", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete reading", exact: true })
      .click();
    await page.getByText("Reading deleted.", { exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "A fresh page for this day", exact: true })
      .waitFor();
    await logout();
  }
  await login("doctor@example.test");
  await page
    .getByRole("heading", { name: "Assigned patients", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Daily report", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^(Edit|Delete|Add reading)/ })
      .count(),
    0,
  );
  assert.equal(await page.getByRole("alert").count(), 0);
  await logout();
  assert.deepEqual(errors, []);
} catch (error) {
  if (page) {
    console.error(
      "Browser verification state:",
      JSON.stringify({
        path: new URL(page.url()).pathname,
        alerts: await page.getByRole("alert").allTextContents(),
      }),
    );
    await page.screenshot({ path: "/tmp/sweety-deployed-failure.png" });
  }
  throw error;
} finally {
  try {
    if (page && !page.isClosed()) await page.unrouteAll({ behavior: "wait" });
    await browser?.close();
  } finally {
    if (pool)
      try {
        const { rows } = await pool.query(
          "SELECT id FROM users WHERE email=$1",
          [email],
        );
        if (rows.length) {
          await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [
            String(rows[0].id),
          ]);
          await pool.query("DELETE FROM users WHERE id=$1", [rows[0].id]);
        }
      } finally {
        await pool.end();
      }
  }
}
console.log(
  `HTTPS browser passed: patient reports/history/chart, doctor read-only access${pool ? ", synthetic registration and reading CRUD" : ""}.`,
);
