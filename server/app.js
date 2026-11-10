import express from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { rateLimit } from "express-rate-limit";
import { today, validDate, ranges, slots } from "./dates.js";
import { pagination, pageInfo } from "./pagination.js";
import {
  loadReports,
  loadMonthly,
  readingFields,
  createReportReader,
} from "./reports.js";
import { transaction } from "./database.js";
import { addDoctorRoutes } from "./doctor.js";
const fail = (status, code, message, fields) =>
  Object.assign(new Error(message), { status, code, fields });
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});
export function createApp({
  pool,
  secret,
  origin = "http://127.0.0.1:5173",
  production = false,
  now = () => new Date(),
  authLimit = 30,
  cache = null,
  onCacheEvent = (result) =>
    console.info(JSON.stringify({ event: "report_cache", result })),
}) {
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const app = express();
  const readReport = createReportReader(pool, cache, onCacheEvent);
  app.disable("x-powered-by");
  if (production) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    )
      return next(fail(400, "INVALID_JSON", "Send a JSON object."));
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== origin
    )
      return next(
        fail(
          403,
          "ORIGIN_REJECTED",
          "Please use the application to make this change.",
        ),
      );
    next();
  });
  const Store = connectPg(session);
  const store = new Store({
    pool,
    tableName: "sessions",
    pruneSessionInterval: false,
  });
  app.locals.sessionStore = store;
  app.use(
    session({
      store,
      secret,
      name: "sweety.sid",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: production,
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: "RATE_LIMIT",
          message: "Too many attempts. Please try again in 15 minutes.",
        },
      }),
  });
  function validateAccount(body, register) {
    const { name, email, password } = body;
    const fields = {};
    if (
      register &&
      (typeof name !== "string" || !name.trim() || name.trim().length > 100)
    )
      fields.name = "Enter a name between 1 and 100 characters.";
    if (
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    )
      fields.email = "Enter a valid email address.";
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password) > 72
    )
      fields.password =
        "Use at least 8 characters and no more than 72 UTF-8 bytes.";
    if (Object.keys(fields).length)
      throw fail(
        400,
        "VALIDATION",
        "Please check the highlighted fields.",
        fields,
      );
    return {
      name: register ? name.trim() : undefined,
      email: email.trim().toLowerCase(),
      password,
    };
  }
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const data = validateAccount(req.body, true);
    const hash = await bcrypt.hash(data.password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role",
      [data.name, data.email, hash],
    );
    res.status(201).json({ user: publicUser(rows[0]) });
  });
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const data = validateAccount(req.body, false);
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
      data.email,
    ]);
    // Perform a hash comparison even for unknown accounts.
    const hash =
      rows[0]?.password_hash ??
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxS2VEs3VevYxGxNq1AsTnGEGqC";
    const match = await bcrypt.compare(data.password, hash);
    if (!rows.length || !match)
      throw fail(401, "CREDENTIALS", "Email or password is incorrect.");
    await new Promise((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.userId = rows[0].id;
    await new Promise((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
    res.json({ user: publicUser(rows[0]) });
  });
  app.post("/api/auth/logout", (req, res, next) =>
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("sweety.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: production,
      });
      res.status(204).end();
    }),
  );
  app.use("/api", async (req, res, next) => {
    if (!req.session.userId)
      throw fail(401, "AUTH_REQUIRED", "Please log in to continue.");
    const { rows } = await pool.query(
      "SELECT id,name,email,role FROM users WHERE id=$1",
      [req.session.userId],
    );
    if (!rows.length) throw fail(401, "AUTH_REQUIRED", "Please log in again.");
    req.user = rows[0];
    next();
  });
  app.get("/api/auth/me", (req, res) =>
    res.json({
      user: publicUser(req.user),
      today: today(now()),
      timezone: "Asia/Kolkata",
    }),
  );
  for (const path of ["/api/readings", "/api/reports"])
    app.use(path, (req, res, next) => {
      if (req.user.role !== "patient")
        return next(fail(403, "ROLE_REQUIRED", "Patient access is required."));
      next();
    });
  function checkDate(date) {
    if (validDate(date) && date > today(now()))
      throw fail(400, "VALIDATION", "Date cannot be in the future.", {
        date: "Date cannot be in the future.",
      });
    if (!validDate(date))
      throw fail(
        400,
        "VALIDATION",
        "Choose a valid date from 1900 through today.",
        { date: "Choose a valid date that is not in the future." },
      );
    return date;
  }
  function validateReading(body) {
    checkDate(body.date);
    const fields = {};
    if (!slots.includes(body.slot))
      fields.slot = "Choose one of the four meal slots.";
    if (body.value === undefined || body.value === null || body.value === "")
      fields.value = "Please enter a glucose value.";
    else if (
      !Number.isInteger(body.value) ||
      body.value < 40 ||
      body.value > 600
    )
      fields.value = "Value must be a whole number between 40 and 600 mg/dl.";
    if (Object.keys(fields).length)
      throw fail(
        400,
        "VALIDATION",
        "Please check the highlighted fields.",
        fields,
      );
  }
  function versionAndId(req) {
    if (
      !/^\d+$/.test(req.params.id) ||
      !Number.isSafeInteger(Number(req.params.id)) ||
      Number(req.params.id) > 2147483647
    )
      throw fail(404, "NOT_FOUND", "Reading not found.");
    if (
      !Number.isSafeInteger(req.body.version) ||
      req.body.version < 1 ||
      req.body.version > 2147483647
    )
      throw fail(400, "VALIDATION", "A valid reading version is required.");
  }
  async function missingOrStale(req, database = pool) {
    const { rowCount } = await database.query(
      "SELECT id FROM readings WHERE id=$1 AND user_id=$2",
      [req.params.id, req.session.userId],
    );
    if (!rowCount) throw fail(404, "NOT_FOUND", "Reading not found.");
    throw fail(
      409,
      "STALE_VERSION",
      "This reading changed elsewhere. Reload the latest data before trying again.",
    );
  }
  async function writeReading(req, query, parameters, existing = false) {
    return transaction(pool, async (client) => {
      const result = await client.query(query, parameters);
      if (existing && !result.rowCount) await missingOrStale(req, client);
      await client.query(
        "UPDATE users SET report_revision=report_revision+1 WHERE id=$1",
        [req.session.userId],
      );
      return result;
    });
  }
  app.get("/api/readings", async (req, res) => {
    const date =
      req.query.date === undefined ? null : checkDate(req.query.date);
    if (
      date === null ||
      req.query.page !== undefined ||
      req.query.limit !== undefined
    ) {
      const { page, limit, offset } = pagination(req.query);
      const { rows } = await pool.query(
        `WITH filtered AS (SELECT ${readingFields} FROM readings WHERE user_id=$1 AND ($2::date IS NULL OR reading_date=$2::date)),
        selected AS (SELECT * FROM filtered ORDER BY date DESC,array_position($3::text[],slot),id LIMIT $4 OFFSET $5)
        SELECT (SELECT COUNT(*)::integer FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(selected ORDER BY date DESC,array_position($3::text[],slot),id) FROM selected),'[]'::jsonb) AS readings`,
        [req.session.userId, date, slots, limit, offset],
      );
      return res.json({
        readings: rows[0].readings,
        pagination: pageInfo(page, limit, rows[0].total),
      });
    }
    const { rows } = await pool.query(
      `SELECT ${readingFields} FROM readings WHERE user_id=$1 AND reading_date=$2 ORDER BY array_position($3::text[],slot)`,
      [req.session.userId, req.query.date, slots],
    );
    res.json({ readings: rows });
  });
  app.post("/api/readings", async (req, res) => {
    validateReading(req.body);
    const { date, slot, value } = req.body;
    const { rows } = await writeReading(
      req,
      `INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,$3,$4) RETURNING ${readingFields}`,
      [req.session.userId, date, slot, value],
    );
    res.status(201).json({ reading: rows[0] });
  });
  app.put("/api/readings/:id", async (req, res) => {
    versionAndId(req);
    validateReading(req.body);
    const { date, slot, value, version } = req.body;
    const { rows } = await writeReading(
      req,
      `UPDATE readings SET reading_date=$1,slot=$2,glucose_value=$3,version=version+1,updated_at=now() WHERE id=$4 AND user_id=$5 AND version=$6 RETURNING ${readingFields}`,
      [date, slot, value, req.params.id, req.session.userId, version],
      true,
    );
    res.json({ reading: rows[0] });
  });
  app.delete("/api/readings/:id", async (req, res) => {
    versionAndId(req);
    await writeReading(
      req,
      "DELETE FROM readings WHERE id=$1 AND user_id=$2 AND version=$3",
      [req.params.id, req.session.userId, req.body.version],
      true,
    );
    res.status(204).end();
  });
  async function summary(req, res, userId) {
    const date = checkDate(req.query.date);
    res.json(
      await readReport(userId, "summary", date, () =>
        loadReports(pool, userId, date),
      ),
    );
  }
  async function monthly(req, res, userId) {
    const month = req.query.month;
    if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month))
      throw fail(
        400,
        "VALIDATION",
        "Choose a valid month from 1900 through this month.",
      );
    const start = checkDate(`${month}-01`);
    const [year, monthNumber] = month.split("-").map(Number);
    const end =
      month === today(now()).slice(0, 7)
        ? ranges(today(now())).daily[1]
        : new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    res.json(
      await readReport(userId, "monthly", `${start}:${end}`, () =>
        loadMonthly(pool, userId, start, end),
      ),
    );
  }
  app.get("/api/reports", (req, res) => summary(req, res, req.user.id));
  app.get("/api/reports/monthly", (req, res) => monthly(req, res, req.user.id));
  addDoctorRoutes(app, { pool, summary, monthly });
  app.use("/api", (req, res, next) =>
    next(fail(404, "NOT_FOUND", "Endpoint not found.")),
  );
  app.use(express.static(new URL("../dist", import.meta.url).pathname));
  app.get("/{*path}", (req, res) =>
    res.sendFile(new URL("../dist/index.html", import.meta.url).pathname),
  );
  app.use(async (error, req, res, next) => {
    if (error.code === "23505" && error.constraint === "users_email_key")
      error = fail(
        409,
        "EMAIL_EXISTS",
        "An account with this email already exists.",
      );
    else if (
      error.code === "23505" &&
      error.constraint === "readings_user_date_slot_key"
    ) {
      try {
        // The unique constraint resolves races first. This lookup only chooses
        // the explanatory message after the write has already been rejected.
        const { rows } =
          req.method === "POST"
            ? await pool.query(
                "SELECT COUNT(*)::integer AS count FROM readings WHERE user_id=$1 AND reading_date=$2",
                [req.session.userId, req.body.date],
              )
            : { rows: [{ count: 0 }] };
        const labels = {
          morning_fasting: "Morning (fasting)",
          after_breakfast: "After breakfast",
          after_lunch: "After lunch",
          after_dinner: "After dinner",
        };
        const label = labels[req.body.slot];
        error =
          rows[0].count >= 4
            ? fail(409, "DAILY_LIMIT", "You can add only 4 readings per day.")
            : fail(
                409,
                "DUPLICATE_SLOT",
                `You already have ${label.startsWith("After") ? "an" : "a"} ${label} reading for this date.`,
              );
      } catch (lookupError) {
        error = lookupError;
      }
    }
    if (error.type === "entity.parse.failed")
      error = fail(400, "INVALID_JSON", "Send a valid JSON object.");
    if (error.type === "entity.too.large")
      error = fail(413, "BODY_TOO_LARGE", "Request is too large.");
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      error: {
        code: error.status ? error.code : "INTERNAL",
        message: error.status
          ? error.message
          : "Something went wrong. Please try again.",
        ...(error.fields && { fields: error.fields }),
      },
    });
  });
  return app;
}
