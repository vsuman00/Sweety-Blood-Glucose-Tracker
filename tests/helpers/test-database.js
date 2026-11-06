import pg from "pg";

// Parse through the same driver used by the tests, without opening a connection.
// Reject matching database names even across hosts: fail closed before any reset.
export function testDatabaseUrl(env = process.env) {
  try {
    if (!env.TEST_DATABASE_URL || !env.DATABASE_URL) throw new Error();
    const testName = new pg.Client({ connectionString: env.TEST_DATABASE_URL })
      .database;
    const appName = new pg.Client({ connectionString: env.DATABASE_URL })
      .database;
    if (!testName.endsWith("_test") || testName === appName) throw new Error();
    return env.TEST_DATABASE_URL;
  } catch {
    throw new Error(
      "Set DATABASE_URL and a separate TEST_DATABASE_URL whose database name ends in _test and differs from the application database name.",
    );
  }
}
