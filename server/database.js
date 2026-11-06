import pg from 'pg';
import { readFile } from 'node:fs/promises';
pg.types.setTypeParser(1082, value => value); // DATE stays a calendar string.
export const makePool = connectionString => new pg.Pool({ connectionString });
export async function migrate(pool) {
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
  const {rows} = await client.query('SELECT version FROM schema_migrations WHERE version=1');
  if (!rows.length) {
   await client.query(await readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8'));
   await client.query('INSERT INTO schema_migrations VALUES (1)');
  }
  await client.query('COMMIT');
 } catch (error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
