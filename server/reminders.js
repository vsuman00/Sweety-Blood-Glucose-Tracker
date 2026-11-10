import { today, validDate } from "./dates.js";

export function previousDate(now = new Date()) {
  const date = new Date(`${today(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function jobDate(job) {
  if (job.data?.date !== undefined) {
    if (!validDate(job.data.date))
      throw new Error("Job requires a valid date.");
    return job.data.date;
  }
  // BullMQ 6 serializes the immutable scheduled timestamp in this generated ID;
  // prevMillis is an internal producer option and is absent on deserialized jobs.
  const prefix =
    typeof job.repeatJobKey === "string" ? `repeat:${job.repeatJobKey}:` : null;
  const suffix =
    prefix && typeof job.id === "string" && job.id.startsWith(prefix)
      ? job.id.slice(prefix.length)
      : "";
  const scheduled = /^\d+$/.test(suffix) ? Number(suffix) : null;
  if (!Number.isSafeInteger(scheduled) || scheduled < 1)
    throw new Error("Job is missing its scheduled date.");
  return previousDate(new Date(scheduled));
}
export async function processReminders(
  pool,
  date,
  { now = new Date(), batchSize = 100 } = {},
) {
  if (!validDate(date) || date >= today(now))
    throw new Error("Choose a valid completed reading day.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error("Batch size must be between 1 and 1000.");
  let cursor = 0,
    created = 0;
  while (true) {
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE id>$1 AND role='patient' AND created_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY id LIMIT $3",
      [cursor, date, batchSize],
    );
    if (!rows.length) break;
    const result = await pool.query(
      `INSERT INTO reminder_logs(user_id,reading_date,reading_count)
      SELECT u.id,$2::date,COUNT(r.id)::integer FROM users u
      LEFT JOIN readings r ON r.user_id=u.id AND r.reading_date=$2::date
      WHERE u.id=ANY($1::integer[]) AND u.role='patient'
        AND u.created_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      GROUP BY u.id HAVING COUNT(r.id)<4
      ON CONFLICT(user_id,reading_date) DO NOTHING RETURNING user_id`,
      [rows.map((row) => row.id), date],
    );
    created += result.rowCount;
    cursor = rows.at(-1).id;
  }
  return { date, created };
}
