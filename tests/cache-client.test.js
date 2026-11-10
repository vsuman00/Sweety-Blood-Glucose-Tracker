import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../server/cache.js";
const env = {
  UPSTASH_REDIS_REST_URL: "https://cache.example.test",
  UPSTASH_REDIS_REST_TOKEN: "test-only",
  CACHE_NAMESPACE: "sweety:test",
};
test("cache configuration is explicit and protects credentials", () => {
  assert.equal(createCache({}), null);
  for (const config of [
    { UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL },
    { ...env, UPSTASH_REDIS_REST_URL: "http://unsafe.test" },
    { ...env, CACHE_NAMESPACE: "" },
    { ...env, CACHE_NAMESPACE: "space here" },
  ])
    assert.throws(() => createCache(config), /UPSTASH|CACHE_NAMESPACE|HTTPS/);
});
test("Upstash client serializes reports, uses TTL, and bounds a stalled request", async () => {
  const original = globalThis.fetch;
  const commands = [];
  try {
    globalThis.fetch = async (_url, options) => {
      commands.push(JSON.parse(options.body));
      assert.equal(options.headers.authorization, "Bearer test-only");
      return new Response(
        JSON.stringify({ result: commands.length === 1 ? '"cached"' : "OK" }),
        { status: 200 },
      );
    };
    const cache = createCache(env);
    assert.equal(await cache.get("key"), "cached");
    await cache.set("key", { count: 1 }, 60);
    assert.ok(
      commands[1].map(String).some((value) => value.toLowerCase() === "ex"),
    );
    assert.ok(commands[1].includes(60));
    globalThis.fetch = async (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    const started = Date.now();
    await assert.rejects(cache.get("stalled"));
    assert.ok(
      Date.now() - started < 1800,
      "Cache timeout must not retry for several seconds",
    );
  } finally {
    globalThis.fetch = original;
  }
});
