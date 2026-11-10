import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupLiveCache } from "./helpers/cleanup-cache.js";
test("live cache cleanup closes database/session resources even when Redis deletion fails", async () => {
  const calls = [];
  await assert.rejects(
    cleanupLiveCache({
      cache: {
        namespace: "unit",
        delete: async (key) => {
          calls.push(key);
          throw new Error("Redis offline");
        },
      },
      keys: new Set(["unit:a", "unit:b"]),
      userId: 12,
      pool: {
        query: async (sql) => calls.push(sql),
        end: async () => calls.push("pool closed"),
      },
      store: { close: () => calls.push("store closed") },
    }),
    /cleanup failed/,
  );
  assert.equal(calls.length, 6);
  assert.ok(calls.some((value) => value.startsWith("DELETE FROM users")));
  assert.deepEqual(calls.slice(-2), ["store closed", "pool closed"]);
});
