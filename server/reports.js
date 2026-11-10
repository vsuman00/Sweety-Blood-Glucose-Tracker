import { ranges, slots, validDate } from "./dates.js";
export const readingFields =
  "id, reading_date AS date, slot, glucose_value AS value, version";

function validReadings(readings) {
  return (
    Array.isArray(readings) &&
    readings.every(
      (reading) =>
        Number.isSafeInteger(reading.id) &&
        reading.id > 0 &&
        validDate(reading.date) &&
        slots.includes(reading.slot) &&
        Number.isInteger(reading.value) &&
        reading.value >= 40 &&
        reading.value <= 600 &&
        Number.isInteger(reading.version) &&
        reading.version > 0,
    )
  );
}
function validCached(kind, value, period) {
  if (!value || typeof value !== "object") return false;
  if (kind === "monthly") {
    const [start, end] = period.split(":");
    return (
      value.start === start &&
      value.end === end &&
      validReadings(value.readings) &&
      value.readings.every((row) => row.date >= start && row.date < end)
    );
  }
  return Object.entries(ranges(period)).every(([name, [start, end]]) => {
    const report = value[name];
    return (
      report &&
      report.start === start &&
      report.end === end &&
      Number.isSafeInteger(report.count) &&
      report.count >= 0 &&
      validReadings(report.readings) &&
      (name !== "daily" || report.readings.length === report.count) &&
      [report.highest, report.lowest, report.average].every((number) =>
        report.count === 0
          ? number === null
          : typeof number === "number" &&
            Number.isFinite(number) &&
            number >= 40 &&
            number <= 600,
      )
    );
  });
}
export function createReportReader(pool, cache, onEvent = () => {}) {
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      /* Diagnostics must not break reports. */
    }
  };
  return async (userId, kind, period, load) => {
    if (!cache) return load();
    const { rows } = await pool.query(
      "SELECT report_revision FROM users WHERE id=$1",
      [userId],
    );
    if (!rows.length)
      throw Object.assign(new Error("Please log in again."), {
        status: 401,
        code: "AUTH_REQUIRED",
      });
    const key = `${cache.namespace}:reports:v1:patient:${userId}:revision:${rows[0].report_revision}:${kind}:${period}`;
    try {
      const value = await cache.get(key);
      if (validCached(kind, value, period)) {
        emit("hit");
        return value;
      }
      emit(value === null ? "miss" : "invalid");
    } catch {
      emit("fallback");
      return load();
    }
    const value = await load();
    try {
      await cache.set(key, value, 60);
    } catch {
      emit("fallback");
    }
    return value;
  };
}

export async function loadReports(pool, userId, date) {
  const periods = ranges(date);
  const { rows } = await pool.query(
    `WITH periods AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS p(name text,start date,"end" date))
   SELECT p.name,p.start,p."end",MAX(r.glucose_value) AS highest,MIN(r.glucose_value) AS lowest,
   ROUND(AVG(r.glucose_value),1)::float8 AS average,COUNT(r.id)::integer AS count,
   COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'date',r.reading_date,'slot',r.slot,'value',r.glucose_value,'version',r.version)
   ORDER BY array_position($3::text[],r.slot)) FILTER (WHERE r.id IS NOT NULL AND p.name='daily'),'[]') AS readings
   FROM periods p LEFT JOIN readings r ON r.user_id=$1 AND r.reading_date>=p.start AND r.reading_date<p."end"
   GROUP BY p.name,p.start,p."end"`,
    [
      userId,
      JSON.stringify(
        Object.entries(periods).map(([name, [start, end]]) => ({
          name,
          start,
          end,
        })),
      ),
      slots,
    ],
  );
  return Object.fromEntries(rows.map(({ name, ...report }) => [name, report]));
}

export async function loadMonthly(pool, userId, start, end) {
  const { rows } = await pool.query(
    `SELECT ${readingFields} FROM readings WHERE user_id=$1 AND reading_date >= $2 AND reading_date < $3 ORDER BY reading_date,array_position($4::text[],slot),id`,
    [userId, start, end, slots],
  );
  return { start, end, readings: rows };
}
