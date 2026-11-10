import { attachDatabasePool } from "@vercel/functions";
import { makePool } from "../server/database.js";
import { createApp } from "../server/app.js";
import { createCache } from "../server/cache.js";
import { runtimeOrigin } from "../server/runtime.js";

const pool = makePool(process.env.DATABASE_URL);
attachDatabasePool(pool);

export default createApp({
  pool,
  secret: process.env.SESSION_SECRET,
  origin: runtimeOrigin(),
  production: process.env.NODE_ENV === "production",
  cache: createCache(),
});
