import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeOrigin } from "../server/runtime.js";
test("preview origin uses Vercel's assigned hostname; production requires explicit origin", () => {
  assert.equal(
    runtimeOrigin({
      VERCEL_ENV: "preview",
      VERCEL_URL: "sweety-test.vercel.app",
    }),
    "https://sweety-test.vercel.app",
  );
  assert.equal(
    runtimeOrigin({
      APP_ORIGIN: "https://example.test",
      NODE_ENV: "production",
    }),
    "https://example.test",
  );
  assert.equal(runtimeOrigin({}), "http://127.0.0.1:5173");
  assert.throws(() => runtimeOrigin({ NODE_ENV: "production" }), /APP_ORIGIN/);
  assert.throws(
    () =>
      runtimeOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "untrusted.test/path",
      }),
    /VERCEL_URL/,
  );
});
