import { testDatabaseUrl } from "./helpers/test-database.js";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { makePool, migrate } from "../server/database.js";
import { createApp } from "../server/app.js";
const url = testDatabaseUrl();
const pool = makePool(url);
await migrate(pool);
const origin = "http://127.0.0.1:3002";
const app = createApp({
  pool,
  secret: "browser-test-only-secret-at-least-32-chars",
  origin,
});
const server = await new Promise((resolve) => {
  const server = app.listen(3002, "127.0.0.1", () => resolve(server));
});
const email = `browser-${Date.now()}@example.test`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Browser Tester");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("heading", { name: "Hello, Browser Tester." }).waitFor();
  await page
    .getByRole("heading", { name: "A fresh page for this day" })
    .waitFor();
  const valueInput = page.getByLabel("Glucose (mg/dl)", { exact: true });
  await page.getByRole("button", { name: "Add reading", exact: true }).click();
  assert.equal(
    await valueInput.evaluate((input) => input.validationMessage),
    "Please enter a glucose value.",
  );
  for (const value of ["39", "601", "100.5"]) {
    await valueInput.fill(value);
    await page
      .getByRole("button", { name: "Add reading", exact: true })
      .click();
    assert.equal(
      await valueInput.evaluate((input) => input.validationMessage),
      "Value must be a whole number between 40 and 600 mg/dl.",
    );
  }
  const dateInput = page.getByLabel("Date", { exact: true });
  const today = await dateInput.inputValue();
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await valueInput.fill("100");
  await dateInput.fill(tomorrow.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Add reading", exact: true }).click();
  assert.equal(
    await dateInput.evaluate((input) => input.validationMessage),
    "Date cannot be in the future.",
  );
  await dateInput.fill(today);
  await page.getByLabel("Glucose (mg/dl)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Add reading", exact: true }).click();
  await page.getByText("Reading added.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Edit Morning (fasting)", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".daily-panel .stats dd").nth(2).innerText(),
    "100.0",
  );
  await page.getByLabel("Glucose (mg/dl)", { exact: true }).fill("111");
  await page.getByRole("button", { name: "Add reading", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({
      hasText: "You already have a Morning (fasting) reading for this date.",
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Edit Morning (fasting)", exact: true })
    .click();
  await page.getByLabel("Glucose (mg/dl)", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Reading updated.", { exact: true }).waitFor();
  for (const [slot, value] of [
    ["after_breakfast", "110"],
    ["after_lunch", "120"],
    ["after_dinner", "130"],
  ]) {
    await page.getByLabel("Meal slot").selectOption(slot);
    await valueInput.fill(value);
    await page
      .getByRole("button", { name: "Add reading", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Edit ${slot === "after_breakfast" ? "After breakfast" : slot === "after_lunch" ? "After lunch" : "After dinner"}`,
        exact: true,
      })
      .waitFor();
  }
  await valueInput.fill("140");
  await page.getByRole("button", { name: "Add reading", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "You can add only 4 readings per day." })
    .waitFor();
  await page
    .getByRole("button", { name: "Edit Morning (fasting)", exact: true })
    .click();
  await page.getByLabel("Meal slot").selectOption("after_lunch");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({
      hasText: "You already have an After lunch reading for this date.",
    })
    .waitFor();
  await page.getByLabel("Meal slot").selectOption("morning_fasting");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Reading updated.", { exact: true }).waitFor();
  for (const label of ["After breakfast", "After lunch", "After dinner"]) {
    await page
      .getByRole("button", { name: `Delete ${label}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete reading", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Delete ${label}`, exact: true })
      .waitFor({ state: "detached" });
  }

  await page
    .getByRole("button", { name: "Delete Morning (fasting)", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page
    .getByRole("button", { name: "Delete Morning (fasting)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete reading", exact: true })
    .click();
  await page.getByText("Reading deleted.", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "A fresh page for this day" })
    .waitFor();
  await pool.query(
    `INSERT INTO readings(user_id,reading_date,slot,glucose_value)
     SELECT u.id,$1::date-days.day,slot,140 FROM users u,
     generate_series(1,6) days(day),unnest($2::text[]) slot WHERE u.email=$3`,
    [
      today,
      ["morning_fasting", "after_breakfast", "after_lunch", "after_dinner"],
      email,
    ],
  );
  await page.reload();
  await page.getByText("Page 1 of 2 · 24 readings", { exact: true }).waitFor();
  assert.equal(await page.locator(".history-panel tbody tr").count(), 20);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByText("Page 2 of 2 · 24 readings", { exact: true }).waitFor();
  assert.equal(await page.locator(".history-panel tbody tr").count(), 4);
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await page.getByText("Page 1 of 2 · 24 readings", { exact: true }).waitFor();
  await page.locator(".chart-container svg.recharts-surface").first().waitFor();
  await page.screenshot({
    path: "docs/screenshots/optional-dashboard.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const box = document.querySelector(".chart-container"),
      chart = box?.querySelector(".recharts-wrapper");
    return (
      !chart ||
      chart.getBoundingClientRect().width <=
        box.getBoundingClientRect().width + 1
    );
  });
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > window.innerWidth + 1;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        class: element.getAttribute("class"),
        right: element.getBoundingClientRect().right,
        text: element.textContent.slice(0, 60),
      })),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    JSON.stringify(overflow),
  );
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser journey passed: registration, empty state, create, duplicate error, edit, rounding, delete dialog, mobile layout, logout.",
  );
} finally {
  await browser?.close();
  await pool.query("DELETE FROM users WHERE email=$1", [email]);
  app.locals.sessionStore.close();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
