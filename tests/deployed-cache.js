import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createCache } from "../server/cache.js";
import { createRedisClient } from "../lib/redis.ts";
import { makePool } from "../server/database.js";
import { ranges } from "../server/dates.js";
import { cleanupLiveCache } from "./helpers/cleanup-cache.js";

const origin = new URL(process.argv[2]).origin;
assert.equal(new URL(origin).protocol, "https:");
assert.ok(
  process.env.DEPLOYMENT_TEST_DATABASE_URL,
  "Set DEPLOYMENT_TEST_DATABASE_URL explicitly for targeted synthetic cleanup.",
);
const appOrigin = process.env.DEPLOYMENT_APP_ORIGIN || origin;
const cache = createCache();
assert.ok(cache, "Configure the deployment's real Upstash cache credentials.");
const redis = createRedisClient();
const pool = makePool(process.env.DEPLOYMENT_TEST_DATABASE_URL);
const keys = new Set();
const account = {
  name: "Deployment cache verification",
  email: `deployment-cache-${randomUUID()}@example.test`,
  password: randomUUID(),
};
let cookie, verifiedUserId;
async function api(path, method = "GET", body, expected = 200) {
  const headers = { "Content-Type": "application/json", Origin: appOrigin };
  if (cookie) headers.Cookie = cookie;
  if (process.env.VERCEL_OIDC_TOKEN)
    headers["x-vercel-trusted-oidc-idp-token"] = process.env.VERCEL_OIDC_TOKEN;
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
    headers["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const response = await fetch(new URL(`/api${path}`, origin), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response;
}
try {
  const registered = await api("/auth/register", "POST", account, 201);
  const userId = (await registered.json()).user.id;
  const owned = await pool.query(
    "SELECT id FROM users WHERE id=$1 AND email=$2",
    [userId, account.email],
  );
  assert.equal(
    owned.rowCount,
    1,
    "Cleanup database must match the deployment.",
  );
  verifiedUserId = userId;
  const login = await api("/auth/login", "POST", account);
  cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("sweety.sid="))
    ?.split(";")[0];
  assert.ok(cookie);
  const { today: date } = await (await api("/auth/me")).json();
  const [start, end] = ranges(date).monthToDate;
  const key = (revision, kind, period) =>
    `${cache.namespace}:reports:v1:patient:${userId}:revision:${revision}:${kind}:${period}`;
  async function reports(revision, value) {
    const summaryKey = key(revision, "summary", date);
    const chartKey = key(revision, "monthly", `${start}:${end}`);
    keys.add(summaryKey);
    keys.add(chartKey);
    const summary = await (await api(`/reports?date=${date}`)).json();
    const chart = await (
      await api(`/reports/monthly?month=${date.slice(0, 7)}`)
    ).json();
    assert.equal(summary.daily.count, value === null ? 0 : 1);
    assert.equal(summary.daily.average, value);
    assert.deepEqual(
      chart.readings.map((row) => row.value),
      value === null ? [] : [value],
    );
    assert.deepEqual(await cache.get(summaryKey), summary);
    assert.deepEqual(await cache.get(chartKey), chart);
    const ttl = await redis.ttl(summaryKey);
    assert.ok(
      ttl > 0 && ttl <= 60,
      "Deployed reports must have a bounded TTL.",
    );
    return { summary, summaryKey, ttl };
  }
  const initial = await reports(0, null);
  await delay(1100);
  assert.deepEqual(
    await (await api(`/reports?date=${date}`)).json(),
    initial.summary,
  );
  assert.ok(
    (await redis.ttl(initial.summaryKey)) < initial.ttl,
    "A cache hit must reuse the entry rather than reset its expiry.",
  );
  let reading = (
    await (
      await api(
        "/readings",
        "POST",
        { date, slot: "morning_fasting", value: 123 },
        201,
      )
    ).json()
  ).reading;
  await reports(1, 123);
  reading = (
    await (
      await api(`/readings/${reading.id}`, "PUT", {
        date,
        slot: "morning_fasting",
        value: 124,
        version: reading.version,
      })
    ).json()
  ).reading;
  await reports(2, 124);
  await api(
    `/readings/${reading.id}`,
    "DELETE",
    { version: reading.version },
    204,
  );
  await reports(3, null);
  await api("/auth/logout", "POST", {}, 204);
  await api("/auth/me", "GET", undefined, 401);
} finally {
  await cleanupLiveCache({
    cache,
    keys,
    userId: verifiedUserId,
    pool,
    store: { close() {} },
  });
}
console.log(
  "Deployed Upstash passed: real summary/chart entries, hit/TTL, create/edit/delete invalidation, logout, and targeted cleanup.",
);
