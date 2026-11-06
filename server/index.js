import { makePool } from './database.js';
import { createApp } from './app.js';
const pool = makePool(process.env.DATABASE_URL);
const app = createApp({pool, secret:process.env.SESSION_SECRET, origin:process.env.APP_ORIGIN, production:process.env.NODE_ENV === 'production'});
const server = app.listen(Number(process.env.PORT || 3001),'127.0.0.1',() => console.log('Sweety API listening on http://127.0.0.1:'+(process.env.PORT || 3001)));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(async () => {await pool.end(); process.exit(0);}));
