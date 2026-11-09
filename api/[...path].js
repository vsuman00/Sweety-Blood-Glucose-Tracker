import { attachDatabasePool } from "@vercel/functions";
import { makePool } from "../server/database.js";
import { createApp } from "../server/app.js";

const pool = makePool(process.env.DATABASE_URL);
attachDatabasePool(pool);

export default createApp({
  pool,
  secret: process.env.SESSION_SECRET,
  origin: process.env.APP_ORIGIN,
  production: process.env.NODE_ENV === "production",
});
