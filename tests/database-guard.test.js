import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabaseUrl } from "./helpers/test-database.js";
const app = "postgresql://localhost/sweety_test";

test("database guard rejects equivalent targets before any connection or reset", () => {
  for (const target of [
    app,
    `${app}?application_name=tests`,
    "postgresql://localhost:5432/sweety_test",
    "postgresql://127.0.0.1/sweety_test",
    "postgresql://another-user@localhost/sweety_test",
    "postgresql://localhost/sweety%5Ftest",
  ]) {
    assert.throws(
      () => testDatabaseUrl({ DATABASE_URL: app, TEST_DATABASE_URL: target }),
      /separate TEST_DATABASE_URL/,
    );
  }
});
test("database guard requires explicit configuration and a test database name", () => {
  for (const env of [
    {},
    { DATABASE_URL: app },
    { TEST_DATABASE_URL: app },
    {
      DATABASE_URL: "postgresql://localhost/sweety",
      TEST_DATABASE_URL: "postgresql://localhost/sweety_development",
    },
    { DATABASE_URL: app, TEST_DATABASE_URL: "not a database URL" },
  ])
    assert.throws(() => testDatabaseUrl(env), /separate TEST_DATABASE_URL/);
});
test("database guard allows distinct names and harmless connection options", () => {
  const target = "postgresql://localhost/sweety_test?application_name=tests";
  assert.equal(
    testDatabaseUrl({
      DATABASE_URL: "postgresql://localhost/sweety",
      TEST_DATABASE_URL: target,
    }),
    target,
  );
});
