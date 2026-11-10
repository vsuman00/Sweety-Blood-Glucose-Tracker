import { transaction } from "./database.js";

function normalize(email) {
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    throw new Error("Enter a valid account email.");
  return email.trim().toLowerCase();
}
export async function setRole(pool, email, role) {
  email = normalize(email);
  if (!["patient", "doctor"].includes(role))
    throw new Error("Role must be patient or doctor.");
  return transaction(pool, async (client) => {
    const { rows } = await client.query(
      "SELECT id,role FROM users WHERE email=$1 FOR UPDATE",
      [email],
    );
    if (!rows.length) throw new Error("Account not found.");
    if (rows[0].role !== role) {
      await client.query(
        "DELETE FROM doctor_patients WHERE doctor_id=$1 OR patient_id=$1",
        [rows[0].id],
      );
      await client.query("UPDATE users SET role=$1 WHERE id=$2", [
        role,
        rows[0].id,
      ]);
    }
    return { id: rows[0].id, role };
  });
}
async function relationship(pool, doctorEmail, patientEmail, remove) {
  doctorEmail = normalize(doctorEmail);
  patientEmail = normalize(patientEmail);
  if (doctorEmail === patientEmail)
    throw new Error("Doctor and patient must be different accounts.");
  return transaction(pool, async (client) => {
    const { rows } = await client.query(
      "SELECT id,email,role FROM users WHERE email=ANY($1::text[]) ORDER BY id FOR UPDATE",
      [[doctorEmail, patientEmail]],
    );
    if (rows.length !== 2) throw new Error("Both accounts must exist.");
    const doctor = rows.find((row) => row.email === doctorEmail),
      patient = rows.find((row) => row.email === patientEmail);
    if (doctor.role !== "doctor" || patient.role !== "patient")
      throw new Error("Assignment requires a doctor and a patient account.");
    if (remove) {
      const result = await client.query(
        "DELETE FROM doctor_patients WHERE doctor_id=$1 AND patient_id=$2",
        [doctor.id, patient.id],
      );
      if (!result.rowCount)
        throw new Error("Patient is not assigned to this doctor.");
    } else {
      const result = await client.query(
        "INSERT INTO doctor_patients(doctor_id,patient_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING patient_id",
        [doctor.id, patient.id],
      );
      if (!result.rowCount)
        throw new Error("Patient is already assigned to this doctor.");
    }
    return { doctorId: doctor.id, patientId: patient.id };
  });
}
export const assignPatient = (pool, doctorEmail, patientEmail) =>
  relationship(pool, doctorEmail, patientEmail, false);
export const unassignPatient = (pool, doctorEmail, patientEmail) =>
  relationship(pool, doctorEmail, patientEmail, true);

export function parseAccessArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const [action, ...flags] = args;
  const allowed =
    action === "role"
      ? ["email", "role"]
      : ["assign", "unassign"].includes(action)
        ? ["doctor", "patient"]
        : null;
  if (!allowed || flags.length !== 4)
    throw new Error(
      "Use role --email EMAIL --role patient|doctor, or assign/unassign --doctor EMAIL --patient EMAIL.",
    );
  const result = { action };
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    if (
      !flag.startsWith("--") ||
      !allowed.includes(flag.slice(2)) ||
      result[flag.slice(2)] !== undefined ||
      !flags[index + 1] ||
      flags[index + 1].startsWith("--")
    )
      throw new Error("Unknown, missing or repeated option.");
    result[flag.slice(2)] = flags[index + 1];
  }
  if (action === "role") {
    result.email = normalize(result.email);
    if (!["doctor", "patient"].includes(result.role))
      throw new Error("Role must be patient or doctor.");
  } else {
    result.doctor = normalize(result.doctor);
    result.patient = normalize(result.patient);
  }
  return result;
}
