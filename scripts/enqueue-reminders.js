import { createReminderQueue, enqueueDate } from "../server/jobs.js";
let producer;
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help")
    console.log(
      "Usage: npm run reminders:enqueue -- --date=YYYY-MM-DD\nEnqueues a completed day for the configured reminder worker; sends no messages.",
    );
  else {
    const match =
      args.length === 1 && /^--date=(\d{4}-\d{2}-\d{2})$/.exec(args[0]);
    if (!match)
      throw new Error("Use --date=YYYY-MM-DD for a completed reading day.");
    producer = await createReminderQueue();
    const job = await enqueueDate(producer.queue, match[1]);
    console.log(
      `Reminder day queued: ${match[1]} (${job.id}). A separate worker must be running.`,
    );
  }
} catch (error) {
  console.error(
    "Enqueue failed:",
    error.code || error.message.replace(/rediss?:\/\/[^\s]+/g, "[Redis URL]"),
  );
  process.exitCode = 1;
} finally {
  await producer?.close();
}
