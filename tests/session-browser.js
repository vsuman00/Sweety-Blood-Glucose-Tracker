import assert from "node:assert/strict";
import express from "express";
import { chromium } from "playwright";

// Serve only the built client. Every API response is mocked; no database is used.
const app = express();
app.use(express.static(new URL("../dist", import.meta.url).pathname));
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(3003, "127.0.0.1", () => resolve(listener));
  listener.once("error", reject);
});
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const operation of ["save", "delete"]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const date = "2026-11-06";
    const reading = {
      id: 77,
      date,
      slot: "morning_fasting",
      value: 155,
      version: 1,
    };
    const report = (readings = []) => ({
      start: date,
      end: "2026-11-07",
      highest: readings.length ? 155 : null,
      lowest: readings.length ? 155 : null,
      average: readings.length ? 155 : null,
      count: readings.length,
      readings,
    });
    let account = "A";
    let releaseMe;
    let requestedMe;
    const meGate = new Promise((resolve) => (releaseMe = resolve));
    const meRequested = new Promise((resolve) => (requestedMe = resolve));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let status = 200;
      let body;
      if (path === "/api/auth/me") {
        if (account === "B") {
          requestedMe();
          await meGate;
        }
        body = {
          user: { id: account === "A" ? 1 : 2, name: account },
          today: date,
          timezone: "Asia/Kolkata",
        };
      } else if (path === "/api/auth/login") {
        account = "B";
        body = { user: { id: 2, name: "B" } };
      } else if (path === "/api/reports") {
        body = {
          daily: report(account === "A" ? [reading] : []),
          monthToDate: report(),
          previousMonth: report(),
        };
      } else if (path === "/api/readings/77") {
        status = 401;
        body = {
          error: {
            code: "AUTH_REQUIRED",
            message: "Please log in to continue.",
          },
        };
      } else {
        throw new Error(`Unexpected API request: ${path}`);
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    try {
      await page.goto("http://127.0.0.1:3003");
      await page
        .getByRole("button", { name: "Edit Morning (fasting)", exact: true })
        .click();
      assert.equal(await page.locator("#reading-value").inputValue(), "155");
      if (operation === "save") {
        await page
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", {
            name: "Delete Morning (fasting)",
            exact: true,
          })
          .click();
        await page.getByRole("dialog").waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(
          await page.evaluate(() =>
            document.activeElement.getAttribute("aria-label"),
          ),
          "Delete Morning (fasting)",
          "Escape must restore focus to the Delete trigger",
        );
        await page
          .getByRole("button", {
            name: "Delete Morning (fasting)",
            exact: true,
          })
          .click();
        await page.getByRole("dialog").waitFor();
        await page
          .getByRole("button", { name: "Delete reading", exact: true })
          .click();
      }
      await page.getByRole("heading", { name: "Welcome back" }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.getByLabel("Email", { exact: true }).fill("b@example.test");
      await page.getByLabel("Password", { exact: true }).fill("password123");
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await meRequested;
      // Hold the follow-up /me request to expose any transient old-account UI.
      const values = await page
        .locator("#reading-value")
        .evaluateAll((inputs) => inputs.map((input) => input.value));
      assert.equal(
        values.includes("155"),
        false,
        `${operation}: old value leaked during login`,
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Edit reading", exact: true })
          .count(),
        0,
      );
      assert.equal(await page.getByRole("dialog").count(), 0);
      releaseMe();
      await page.getByRole("heading", { name: "Hello, B." }).waitFor();
      await page
        .getByRole("heading", { name: "A fresh page for this day" })
        .waitFor();
      await page
        .getByRole("heading", { name: "Add a reading", exact: true })
        .waitFor();
      assert.equal(await page.locator("#reading-value").inputValue(), "");
      assert.equal(
        await page
          .getByRole("button", { name: "Save changes", exact: true })
          .count(),
        0,
      );
      assert.equal(await page.getByRole("dialog").count(), 0);
      console.log(
        `Session isolation passed after expired-session ${operation}.`,
      );
    } finally {
      releaseMe();
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
