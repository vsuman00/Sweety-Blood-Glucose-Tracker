import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
pg.types.setTypeParser(1082, (value) => value); // DATE stays a calendar string.
export const makePool = (connectionString) => new pg.Pool({ connectionString });
export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(
  pool,
  { directory = fileURLToPath(new URL("../db", import.meta.url)) } = {},
) {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => {
      const match = /^(\d+)_[a-z0-9_]+\.sql$/.exec(name);
      if (
        !match ||
        !Number.isSafeInteger(Number(match[1])) ||
        Number(match[1]) < 1
      )
        throw new Error(`Invalid migration filename: ${name}`);
      return { name, version: Number(match[1]) };
    })
    .sort((a, b) => a.version - b.version);
  if (new Set(files.map((file) => file.version)).size !== files.length)
    throw new Error("Duplicate migration versions.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7349281)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)",
    );
    const { rows } = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const applied = new Set(rows.map((row) => row.version));
    if (rows.some((row) => !files.some((file) => file.version === row.version)))
      throw new Error("Database has migrations missing from this checkout.");
    for (const file of files) {
      if (applied.has(file.version)) continue;
      if (rows.some((row) => row.version > file.version))
        throw new Error(
          "Cannot apply a migration older than the database version.",
        );
      await client.query(await readFile(join(directory, file.name), "utf8"));
      await client.query("INSERT INTO schema_migrations VALUES ($1)", [
        file.version,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
