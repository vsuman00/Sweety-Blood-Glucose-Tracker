import { makePool } from "../server/database.js";
import {
  parseAccessArgs,
  setRole,
  assignPatient,
  unassignPatient,
} from "../server/access.js";
let pool;
try {
  const options = parseAccessArgs(process.argv.slice(2));
  if (options.help)
    console.log(
      "Usage: npm run access -- role --email EMAIL --role patient|doctor\n       npm run access -- assign|unassign --doctor EMAIL --patient EMAIL\nThese commands change roles/assignments in the configured DATABASE_URL.",
    );
  else {
    if (!process.env.DATABASE_URL)
      throw new Error("Set DATABASE_URL for the intended database.");
    pool = makePool(process.env.DATABASE_URL);
    if (options.action === "role")
      await setRole(pool, options.email, options.role);
    else
      await (options.action === "assign" ? assignPatient : unassignPatient)(
        pool,
        options.doctor,
        options.patient,
      );
    console.log("Access updated.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
