import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePool, migrate } from "../server/database.js";
import { testDatabaseUrl } from "./helpers/test-database.js";

test("migrations upgrade v1 without losing data, apply in order, and rerun safely", async () => {
  const pool = makePool(testDatabaseUrl());
  const directory = await mkdtemp(join(tmpdir(), "sweety-migrations-"));
  const schema = `migration_${Date.now()}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(
      await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    );
    await client.query(
      "CREATE TABLE schema_migrations(version integer PRIMARY KEY)",
    );
    await client.query("INSERT INTO schema_migrations VALUES (1)");
    await client.query(
      "INSERT INTO users(name,email,password_hash) VALUES('Kept','kept@example.test','hash')",
    );
    await writeFile(join(directory, "001_initial.sql"), "SELECT 1");
    await writeFile(
      join(directory, "003_second.sql"),
      "ALTER TABLE users ADD COLUMN second integer DEFAULT 3",
    );
    await writeFile(
      join(directory, "002_first.sql"),
      "ALTER TABLE users ADD COLUMN first integer DEFAULT 2",
    );
    const scopedPool = {
      connect: async () => ({ query: client.query.bind(client), release() {} }),
    };
    await migrate(scopedPool, { directory });
    await migrate(scopedPool, { directory });
    const { rows } = await client.query("SELECT name,first,second FROM users");
    assert.deepEqual(rows, [{ name: "Kept", first: 2, second: 3 }]);
    assert.deepEqual(
      (
        await client.query(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      ).rows.map((r) => r.version),
      [1, 2, 3],
    );
    await writeFile(
      join(directory, "004_bad.sql"),
      "ALTER TABLE users ADD COLUMN broken integer; SELECT missing_column FROM users",
    );
    await assert.rejects(migrate(scopedPool, { directory }));
    assert.equal(
      (
        await client.query(
          "SELECT version FROM schema_migrations WHERE version=4",
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND column_name='broken'",
          [schema],
        )
      ).rowCount,
      0,
    );
    await rm(join(directory, "004_bad.sql"));
    await writeFile(join(directory, "002_duplicate.sql"), "SELECT 1");
    await assert.rejects(migrate(scopedPool, { directory }), /duplicate/i);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
