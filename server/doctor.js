import { pagination, pageInfo } from "./pagination.js";
const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

export function addDoctorRoutes(app, { pool, summary, monthly }) {
  app.use("/api/doctor", (req, res, next) => {
    if (req.user.role !== "doctor")
      return next(fail(403, "ROLE_REQUIRED", "Doctor access is required."));
    next();
  });
  app.get("/api/doctor/patients", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { rows } = await pool.query(
      `WITH assigned AS (
      SELECT u.id,u.name FROM users u JOIN doctor_patients a ON a.patient_id=u.id WHERE a.doctor_id=$1 AND u.role='patient'
    ), selected AS (SELECT * FROM assigned ORDER BY name,id LIMIT $2 OFFSET $3)
    SELECT (SELECT COUNT(*)::integer FROM assigned) AS total,
    COALESCE((SELECT jsonb_agg(selected ORDER BY name,id) FROM selected),'[]'::jsonb) AS patients`,
      [req.user.id, limit, offset],
    );
    res.json({
      patients: rows[0].patients,
      pagination: pageInfo(page, limit, rows[0].total),
    });
  });
  async function authorizedPatient(req) {
    const id = req.params.patientId;
    if (
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      Number(id) > 2147483647
    )
      throw fail(404, "NOT_FOUND", "Patient not found.");
    const { rowCount } = await pool.query(
      "SELECT a.patient_id FROM doctor_patients a JOIN users u ON u.id=a.patient_id AND u.role='patient' WHERE a.doctor_id=$1 AND a.patient_id=$2",
      [req.user.id, id],
    );
    if (!rowCount) throw fail(404, "NOT_FOUND", "Patient not found.");
    return Number(id);
  }
  app.get("/api/doctor/patients/:patientId/reports", async (req, res) =>
    summary(req, res, await authorizedPatient(req)),
  );
  app.get("/api/doctor/patients/:patientId/reports/monthly", async (req, res) =>
    monthly(req, res, await authorizedPatient(req)),
  );
}
