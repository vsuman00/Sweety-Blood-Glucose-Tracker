import { makePool, migrate } from '../server/database.js';
const pool = makePool(process.env.DATABASE_URL);
try { await migrate(pool); console.log('Migrations complete.'); } finally { await pool.end(); }
