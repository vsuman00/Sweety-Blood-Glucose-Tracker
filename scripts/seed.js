import bcrypt from "bcrypt";
import { makePool } from "../server/database.js";
import { today, slots } from "../server/dates.js";
const pool = makePool(process.env.DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const password = await bcrypt.hash("Sweety-demo-2026", 12);
  const date = today();
  const [year, month] = date.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 15))
    .toISOString()
    .slice(0, 10);
  for (const [email, name, offset] of [
    ["demo@example.test", "Alex", 0],
    ["other@example.test", "Sam", 30],
  ]) {
    const { rows } = await client.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id",
      [name, email, password],
    );
    if (!rows.length) {
      console.log(`${email} exists; leaving its data unchanged.`);
      continue;
    }
    for (const [day, values] of [
      [date, [92, 128, 116]],
      [`${date.slice(0, 7)}-01`, [100, 135]],
      [previousMonth, [95, 122, 118, 109]],
    ]) {
      for (const [index, value] of values.entries())
        await client.query(
          "INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [rows[0].id, day, slots[index], value + offset],
        );
    }
  }
  await client.query("COMMIT");
  console.log(
    "Synthetic seed complete. Demo login: demo@example.test / Sweety-demo-2026",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
