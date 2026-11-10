import { makePool } from "./database.js";
import { createReminderRuntime } from "./jobs.js";

let pool, runtime;
try {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL for the worker.");
  pool = makePool(process.env.DATABASE_URL);
  runtime = await createReminderRuntime({ pool });
  console.log(
    "Reminder worker ready. Schedule: 00:05 Asia/Kolkata; previous completed day.",
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      const deadline = setTimeout(() => {
        console.error(
          "Worker shutdown deadline reached; interrupted jobs can retry.",
        );
        process.exit(0);
      }, 5000);
      try {
        await runtime.close();
        await pool.end();
        clearTimeout(deadline);
        process.exit(0);
      } catch {
        clearTimeout(deadline);
        console.error("Worker shutdown failed.");
        process.exit(1);
      }
    });
} catch (error) {
  console.error(
    "Worker startup failed:",
    error.code || error.message.replace(/rediss?:\/\/[^\s]+/g, "[Redis URL]"),
  );
  await runtime?.close();
  await pool?.end();
  process.exitCode = 1;
}
